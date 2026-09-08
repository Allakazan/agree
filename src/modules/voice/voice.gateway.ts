import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import {
  BadRequestException,
  Inject,
  Logger,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { Namespace, Socket } from 'socket.io';
import { WsValidationPipe } from 'src/common/pipes/ws-validation.pipe';
import { WsGlobalExceptionFilter } from 'src/common/filters/ws-exception.filter';
import { wsCorsOptions } from 'src/common/cors';
import { User } from 'src/modules/auth/decorators/user.decorator';
import { LoggedUser } from 'src/modules/auth/types/loggedUser.type';
import { AuthGuard } from 'src/modules/auth/guards/auth.guard';
import { WsAuthService } from 'src/modules/auth/ws-auth.service';
import { ChannelType } from '../server/schemas/channel.schema';
import { ServerService } from '../server/server.service';
import { VoiceJoinDto } from './dto/voice-join.dto';
import { VoiceSignalDto } from './dto/voice-signal.dto';
import { VoiceStateDto } from './dto/voice-state.dto';
import { VoiceIceService } from './voice.ice.service';
import {
  VOICE_PRESENCE_STORE,
  VoicePresenceStore,
} from './voice.presence.interface';
import { voiceRoom } from './voice.rooms';
import { VoiceTopologyService } from './voice.topology.service';
import { VoiceJoinAck, VoiceParticipant } from './types/voice.types';

/**
 * Signaling for voice channels. Media never touches this server — Cloud Run
 * carries no UDP, so a self-hosted SFU is impossible and audio goes
 * browser↔browser over a P2P mesh. All that flows through here is who is in a
 * channel and the SDP/ICE needed to connect them.
 *
 * No port argument, same as `ChatGateway`: the gateway attaches to the Nest
 * HTTP server on `$PORT`, and the `voice` namespace is what separates it from
 * `chat` over that one connection.
 *
 * **Authorization is gated in exactly one place.** `voice:join` is the only
 * handler that consults `ServerService`; from then on, presence in
 * `voice:<channelId>` *is* the authorization, asserted with `client.rooms.has`.
 * No other handler may call `join()` — a self-healing join on the signal path
 * would hand a room to any socket that asked for it.
 */
@WebSocketGateway({
  namespace: 'voice',
  cors: wsCorsOptions,
})
@UseFilters(new WsGlobalExceptionFilter())
@UseGuards(AuthGuard)
export class VoiceGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(VoiceGateway.name);

  constructor(
    private readonly serverService: ServerService,
    private readonly wsAuthService: WsAuthService,
    private readonly topologyService: VoiceTopologyService,
    private readonly iceService: VoiceIceService,
    @Inject(VOICE_PRESENCE_STORE)
    private readonly presence: VoicePresenceStore,
  ) {}

  // Typed as the namespace, not the server: a namespaced gateway is handed
  // `server.of('voice')`, and only a Namespace exposes the per-namespace room
  // operations this gateway relies on.
  @WebSocketServer()
  server: Namespace;

  async handleConnection(client: Socket): Promise<void> {
    const user = await this.wsAuthService.authenticate(client);

    if (!user) {
      client.emit('error', { status: 'error', message: 'Unauthorized' });
      client.disconnect(true);
      return;
    }

    (client.data as { user: LoggedUser }).user = user;
  }

  /**
   * The whole reason presence can be trusted. A closed tab, a dropped network,
   * or Cloud Run severing the request at its 60-minute cap all land here — and
   * without it every one of those leaves a ghost in the channel forever. The
   * client's reconnect then issues a fresh `voice:join`.
   *
   * Runs outside the exception filter, like `handleConnection`, so it must
   * never throw.
   */
  async handleDisconnect(client: Socket): Promise<void> {
    try {
      const removals = await this.presence.removeSocket(client.id);

      for (const { channelId, participant, channelEmptied } of removals) {
        this.announceLeft(channelId, participant, channelEmptied);
      }
    } catch (error) {
      this.logger.error(
        `Failed to clear voice presence for socket ${client.id}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  @SubscribeMessage('voice:join')
  async handleJoin(
    @MessageBody(new WsValidationPipe()) dto: VoiceJoinDto,
    @ConnectedSocket() client: Socket,
    @User() user: LoggedUser,
  ): Promise<VoiceJoinAck> {
    const room = voiceRoom(dto.channelId);

    // A repeated join from the same socket is idempotent — re-ack rather than
    // announce the same participant to the room twice.
    const self = await this.presence.findByUser(dto.channelId, user.sub);
    if (self?.socketId === client.id && client.rooms.has(room)) {
      return this.buildAck(dto.channelId, client, user, self);
    }

    // The one authorization gate. `null` covers a malformed id, an unknown
    // channel and a non-member alike, so a stranger cannot probe for which.
    const channel = await this.serverService.findChannelForMember(
      user.sub,
      dto.channelId,
    );

    if (!channel) {
      // BadRequestException, not Forbidden: WsGlobalExceptionFilter only
      // unwraps BadRequestException/WsException — anything else reaches the
      // client as a generic "Internal server error".
      throw new BadRequestException(
        "You are not a member of this channel's server",
      );
    }

    if (channel.type !== ChannelType.VOICE) {
      throw new BadRequestException('This channel is not a voice channel');
    }

    // One active socket per user per channel, so a second tab cannot hear
    // itself. The older socket goes, Discord-style.
    if (self) await this.evict(dto.channelId, self);

    const occupants = await this.presence.countByChannel(dto.channelId);
    const topology = this.topologyService.decideForJoin(
      dto.channelId,
      occupants + 1,
    );

    if (topology !== 'mesh') {
      // Phase 2 answers this by promoting the room onto the Cloudflare SFU and
      // emitting `voice:topology-changed`. Until that exists, a room past the
      // mesh limit has nowhere to put the extra streams, and saying so beats
      // silently degrading everyone's audio.
      throw new BadRequestException(
        `This voice channel is full (${this.topologyService.meshMax} participants)`,
      );
    }

    // Fetched before any state is mutated: it is the one step that talks to the
    // outside world, and a failure here should leave nothing half-joined.
    const iceServers = await this.iceService.getIceServers();

    const participants = await this.presence.listByChannel(dto.channelId);

    await client.join(room);
    const participant = await this.presence.add(dto.channelId, {
      socketId: client.id,
      userId: user.sub,
      username: user.username,
      muted: false,
      deafened: false,
      joinedAt: new Date().toISOString(),
    });

    client
      .to(room)
      .emit('voice:peer-joined', { channelId: dto.channelId, participant });

    return {
      channelId: dto.channelId,
      selfId: user.sub,
      socketId: client.id,
      topology,
      // Everyone already here. The newcomer offers to each of them and they
      // only answer — that convention is what keeps a simultaneous-offer race,
      // and the rollback logic to resolve it, out of the protocol.
      participants,
      iceServers,
      bitrate: this.topologyService.bitrateFor(participants.length + 1),
    };
  }

  @SubscribeMessage('voice:leave')
  async handleLeave(
    @MessageBody(new WsValidationPipe()) dto: VoiceJoinDto,
    @ConnectedSocket() client: Socket,
  ): Promise<{ status: string; channelId: string }> {
    const removed = await this.presence.remove(dto.channelId, client.id);
    await client.leave(voiceRoom(dto.channelId));

    if (removed) {
      const remaining = await this.presence.countByChannel(dto.channelId);
      this.announceLeft(dto.channelId, removed, remaining === 0);
    }

    return { status: 'left', channelId: dto.channelId };
  }

  /**
   * Pure relay: the server never parses SDP. It only proves both ends are in
   * the same room, then hands the payload over untouched.
   */
  @SubscribeMessage('voice:signal')
  async handleSignal(
    @MessageBody(new WsValidationPipe()) dto: VoiceSignalDto,
    @ConnectedSocket() client: Socket,
    @User() user: LoggedUser,
  ): Promise<{ status: string }> {
    this.assertInRoom(client, dto.channelId);

    if (dto.targetUserId === user.sub) {
      throw new BadRequestException('Cannot signal yourself');
    }

    // Presence is both the authorization check and the address: a target that
    // is not in this channel has no socket here to deliver to. Emitting to the
    // socket rather than a user room also keeps a peer's other tabs, possibly
    // sitting in a different voice channel, out of this negotiation.
    const target = await this.presence.findByUser(
      dto.channelId,
      dto.targetUserId,
    );

    if (!target) {
      throw new BadRequestException('That peer is not in this voice channel');
    }

    this.server.to(target.socketId).emit('voice:signal', {
      channelId: dto.channelId,
      fromUserId: user.sub,
      kind: dto.kind,
      payload: dto.payload,
    });

    return { status: 'sent' };
  }

  @SubscribeMessage('voice:state')
  async handleState(
    @MessageBody(new WsValidationPipe()) dto: VoiceStateDto,
    @ConnectedSocket() client: Socket,
  ): Promise<VoiceParticipant> {
    this.assertInRoom(client, dto.channelId);

    const participant = await this.presence.setState(dto.channelId, client.id, {
      muted: dto.muted,
      deafened: dto.deafened,
    });

    if (!participant) {
      throw new BadRequestException('You are not in this voice channel');
    }

    client
      .to(voiceRoom(dto.channelId))
      .emit('voice:state-changed', { channelId: dto.channelId, participant });

    return participant;
  }

  /**
   * Presence in the room is the authorization for every handler after join.
   * Note what this deliberately does *not* do: join the socket. Repairing
   * membership here would grant the room to whoever asked for it.
   */
  private assertInRoom(client: Socket, channelId: string): void {
    if (!client.rooms.has(voiceRoom(channelId))) {
      throw new BadRequestException('Join this voice channel first');
    }
  }

  /**
   * Removes a user's older socket from a channel before their new one takes its
   * place. Presence is cleared here rather than left to `handleDisconnect` so
   * the newcomer's roster cannot race the eviction and list a peer that is on
   * its way out.
   */
  private async evict(
    channelId: string,
    participant: VoiceParticipant,
  ): Promise<void> {
    const removed = await this.presence.remove(channelId, participant.socketId);

    if (removed) {
      const remaining = await this.presence.countByChannel(channelId);
      this.announceLeft(channelId, removed, remaining === 0);
    }

    this.server.to(participant.socketId).emit('voice:evicted', {
      channelId,
      reason: 'joined-from-another-device',
    });

    // `disconnectSockets` goes through the adapter, so it keeps working once
    // this store and the socket.io rooms move behind Redis.
    this.server.in(participant.socketId).disconnectSockets(true);
  }

  /** Broadcasts a departure and hands an emptied room back to the mesh. */
  private announceLeft(
    channelId: string,
    participant: VoiceParticipant,
    channelEmptied: boolean,
  ): void {
    this.server.to(voiceRoom(channelId)).emit('voice:peer-left', {
      channelId,
      participant,
    });

    if (channelEmptied) this.topologyService.release(channelId);
  }

  /** The join ack, rebuilt for an idempotent re-join. */
  private async buildAck(
    channelId: string,
    client: Socket,
    user: LoggedUser,
    self: VoiceParticipant,
  ): Promise<VoiceJoinAck> {
    const participants = (await this.presence.listByChannel(channelId)).filter(
      (participant) => participant.socketId !== self.socketId,
    );

    return {
      channelId,
      selfId: user.sub,
      socketId: client.id,
      topology: this.topologyService.current(channelId),
      participants,
      iceServers: await this.iceService.getIceServers(),
      bitrate: this.topologyService.bitrateFor(participants.length + 1),
    };
  }
}
