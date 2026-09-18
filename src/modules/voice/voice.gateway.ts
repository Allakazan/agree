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
import { Channel, ChannelType } from '../server/schemas/channel.schema';
import { ServerService } from '../server/server.service';
import { VoiceJoinDto } from './dto/voice-join.dto';
import { VoiceSignalDto } from './dto/voice-signal.dto';
import { VoiceStateDto } from './dto/voice-state.dto';
import { VoiceSfuPublishDto } from './dto/voice-sfu-publish.dto';
import { VoiceSfuPullDto } from './dto/voice-sfu-pull.dto';
import { VoiceSfuRenegotiateDto } from './dto/voice-sfu-renegotiate.dto';
import { VoiceSfuCloseDto } from './dto/voice-sfu-close.dto';
import { VoiceSfuLayerDto } from './dto/voice-sfu-layer.dto';
import { VoiceWatchDto } from './dto/voice-watch.dto';
import { VoiceIceService } from './voice.ice.service';
import {
  VOICE_PRESENCE_STORE,
  VoicePresenceStore,
} from './voice.presence.interface';
import { sourceKind } from './voice.simulcast';
import { SessionDescription } from './voice.sfu.client';
import { VoiceSfuPullResult, VoiceSfuService } from './voice.sfu.service';
import { serverRoom, voiceRoom } from './voice.rooms';
import { VoiceTopologyService } from './voice.topology.service';
import {
  VoiceJoinAck,
  VoiceParticipant,
  VoiceWatchAck,
} from './types/voice.types';

/**
 * Signaling for voice channels. Media never touches this server — Cloud Run
 * carries no UDP, so a self-hosted SFU is impossible. A room starts as a P2P
 * mesh (audio only, browser↔browser) and moves onto the Cloudflare Realtime
 * SFU once it outgrows the mesh or anyone publishes video. All that flows
 * through here is who is in a channel, the SDP/ICE to connect them on the
 * mesh, and — on the SFU — every Cloudflare call, proxied so the app secret
 * never reaches a client.
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
 *
 * `voice:watch` is the read-only exception: it gates on server membership and
 * joins `server:<serverId>`, a room that only ever *receives* `voice:presence`
 * — nothing checks it for authorization, so it can't be used as a foothold.
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
    private readonly sfuService: VoiceSfuService,
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
        await this.announceLeft(channelId, participant, channelEmptied);
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
    const match = await this.serverService.findChannelForMember(
      user.sub,
      dto.channelId,
    );

    if (!match) {
      // BadRequestException, not Forbidden: WsGlobalExceptionFilter only
      // unwraps BadRequestException/WsException — anything else reaches the
      // client as a generic "Internal server error".
      throw new BadRequestException(
        "You are not a member of this channel's server",
      );
    }

    if (match.channel.type !== ChannelType.VOICE) {
      throw new BadRequestException('This channel is not a voice channel');
    }

    // One active socket per user per channel, so a second tab cannot hear
    // itself. The older socket goes, Discord-style.
    if (self) await this.evict(dto.channelId, self);

    const count = (await this.presence.countByChannel(dto.channelId)) + 1;

    // Without the SFU the capacity is the mesh limit: past it there is nowhere
    // to put the extra streams, and saying so beats silently degrading
    // everyone's audio. With it, `sfuMax` bounds what one room can cost.
    if (count > this.topologyService.capacity) {
      throw new BadRequestException(
        `This voice channel is full (${this.topologyService.capacity} participants)`,
      );
    }

    // Decided now, applied only once the join can no longer fail — a refused
    // join must not leave the room marked as promoted.
    const promote =
      this.topologyService.current(dto.channelId) === 'mesh' &&
      this.topologyService.needsSfu(count);

    // Fetched before any state is mutated: it is the one step that talks to the
    // outside world, and a failure here should leave nothing half-joined.
    const iceServers = await this.iceService.getIceServers();

    const participants = await this.presence.listByChannel(dto.channelId);

    await client.join(room);
    const participant = await this.presence.add(dto.channelId, {
      socketId: client.id,
      userId: user.sub,
      username: user.username,
      serverId: match.serverId,
      muted: false,
      deafened: false,
      joinedAt: new Date().toISOString(),
      tracks: [],
    });

    if (promote) this.announcePromotion(dto.channelId, client);

    client
      .to(room)
      .emit('voice:peer-joined', { channelId: dto.channelId, participant });
    await this.broadcastPresence(match.serverId, dto.channelId);

    const topology = this.topologyService.current(dto.channelId);

    return {
      channelId: dto.channelId,
      selfId: user.sub,
      socketId: client.id,
      topology,
      // Everyone already here. On the mesh the newcomer offers to each of them
      // and they only answer — that convention is what keeps a
      // simultaneous-offer race, and the rollback logic to resolve it, out of
      // the protocol. On the SFU their `tracks` are what to pull.
      participants,
      iceServers,
      bitrate: this.topologyService.bitrateFor(count, topology),
      video: this.topologyService.videoPolicy(),
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
      await this.announceLeft(dto.channelId, removed, remaining === 0);
    }

    return { status: 'left', channelId: dto.channelId };
  }

  /**
   * Subscribes the socket to server-wide presence: who is in each voice channel
   * of `serverId`, pushed as `voice:presence` whenever it changes, so the
   * channel list can show a call without anyone clicking into it. The ack is
   * the initial snapshot — subscription and first read in one round trip, the
   * way `voice:join` hands back the roster.
   *
   * Gated on server membership, never on a channel: the socket ends up in
   * `server:<serverId>` only, which no handler treats as authorization.
   */
  @SubscribeMessage('voice:watch')
  async handleWatch(
    @MessageBody(new WsValidationPipe()) dto: VoiceWatchDto,
    @ConnectedSocket() client: Socket,
    @User() user: LoggedUser,
  ): Promise<VoiceWatchAck> {
    let channels: Channel[];
    try {
      channels = await this.serverService.findChannelsByServer(
        dto.serverId,
        user.sub,
      );
    } catch {
      // `findChannelsByServer` throws NotFoundException for an unknown server
      // and a non-member alike; only BadRequestException reaches the client.
      throw new BadRequestException('You are not a member of this server');
    }

    await client.join(serverRoom(dto.serverId));

    const voiceChannels = channels.filter(
      (channel) => channel.type === ChannelType.VOICE,
    );
    const rosters = await Promise.all(
      voiceChannels.map(async (channel) => {
        const channelId = String(channel._id);
        return [
          channelId,
          await this.presence.listByChannel(channelId),
        ] as const;
      }),
    );

    return {
      serverId: dto.serverId,
      channels: Object.fromEntries(rosters),
    };
  }

  @SubscribeMessage('voice:unwatch')
  async handleUnwatch(
    @MessageBody(new WsValidationPipe()) dto: VoiceWatchDto,
    @ConnectedSocket() client: Socket,
  ): Promise<{ status: string; serverId: string }> {
    await client.leave(serverRoom(dto.serverId));
    return { status: 'unwatched', serverId: dto.serverId };
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

    // A client that only speaks mesh (or missed `voice:topology-changed`)
    // must not keep running P2P in a room that has outgrown it.
    if (this.topologyService.current(dto.channelId) === 'sfu') {
      throw new BadRequestException(
        'This voice channel is on the media server, not peer to peer',
      );
    }

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
    await this.broadcastPresence(participant.serverId, dto.channelId);

    return participant;
  }

  /**
   * Publishes local tracks to the SFU. On a mesh room this is also how video
   * arrives: the first video publisher takes the whole room onto the SFU,
   * since one room never runs two transports.
   *
   * The SFU call happens *before* the promotion, so a publish Cloudflare
   * refuses leaves the room on the mesh rather than migrating everyone for
   * nothing.
   */
  @SubscribeMessage('voice:sfu:publish')
  async handleSfuPublish(
    @MessageBody(new WsValidationPipe()) dto: VoiceSfuPublishDto,
    @ConnectedSocket() client: Socket,
    @User() user: LoggedUser,
  ): Promise<{
    sessionDescription: SessionDescription;
    tracks: { mid: string; trackName: string }[];
  }> {
    this.assertInRoom(client, dto.channelId);

    const onMesh = this.topologyService.current(dto.channelId) === 'mesh';

    if (onMesh) {
      const video = dto.tracks.some(
        (track) => sourceKind(track.source) === 'video',
      );
      const count = await this.presence.countByChannel(dto.channelId);

      if (!this.topologyService.needsSfu(count, video)) {
        throw new BadRequestException(
          'This voice channel is peer to peer; audio goes over voice:signal',
        );
      }

      if (!this.topologyService.sfuEnabled) {
        throw new BadRequestException('Video is not available on this server');
      }
    }

    const result = await this.sfuService.publish(
      dto.channelId,
      client.id,
      dto.sessionDescription,
      dto.tracks,
    );

    if (onMesh) this.announcePromotion(dto.channelId);

    for (const { track } of result.tracks) {
      client.to(voiceRoom(dto.channelId)).emit('voice:track-published', {
        channelId: dto.channelId,
        userId: user.sub,
        track,
      });
    }

    return {
      sessionDescription: result.sessionDescription,
      tracks: result.tracks.map(({ mid, track }) => ({
        mid,
        trackName: track.trackName,
      })),
    };
  }

  /** Receives other participants' tracks, batched into one negotiation. */
  @SubscribeMessage('voice:sfu:pull')
  async handleSfuPull(
    @MessageBody(new WsValidationPipe()) dto: VoiceSfuPullDto,
    @ConnectedSocket() client: Socket,
  ): Promise<VoiceSfuPullResult> {
    this.assertOnSfu(client, dto.channelId);

    return this.sfuService.pull(dto.channelId, client.id, dto.tracks);
  }

  /** Completes a negotiation Cloudflare started with a pull — the only one it starts. */
  @SubscribeMessage('voice:sfu:renegotiate')
  async handleSfuRenegotiate(
    @MessageBody(new WsValidationPipe()) dto: VoiceSfuRenegotiateDto,
    @ConnectedSocket() client: Socket,
  ): Promise<{ status: string }> {
    this.assertOnSfu(client, dto.channelId);

    await this.sfuService.renegotiate(
      dto.channelId,
      client.id,
      dto.sessionDescription,
    );

    return { status: 'renegotiated' };
  }

  /**
   * Closes tracks on the caller's session, published and pulled alike, and
   * never renegotiates (see `VoiceSfuCloseDto`). Closing a published one takes
   * it off the room — which is also how a camera is turned off: Cloudflare
   * drops a track after 30s without packets, but presence would keep
   * announcing it.
   */
  @SubscribeMessage('voice:sfu:close')
  async handleSfuClose(
    @MessageBody(new WsValidationPipe()) dto: VoiceSfuCloseDto,
    @ConnectedSocket() client: Socket,
    @User() user: LoggedUser,
  ): Promise<{ status: string; mids: string[] }> {
    this.assertOnSfu(client, dto.channelId);

    const result = await this.sfuService.close(
      dto.channelId,
      client.id,
      dto.mids,
    );

    for (const trackName of result.unpublished) {
      client.to(voiceRoom(dto.channelId)).emit('voice:track-unpublished', {
        channelId: dto.channelId,
        userId: user.sub,
        trackName,
      });
    }

    return { status: 'closed', mids: dto.mids };
  }

  /** Switches a pulled video track to another simulcast layer. */
  @SubscribeMessage('voice:sfu:layer')
  async handleSfuLayer(
    @MessageBody(new WsValidationPipe()) dto: VoiceSfuLayerDto,
    @ConnectedSocket() client: Socket,
  ): Promise<{ status: string; mid: string; preferredRid: string }> {
    this.assertOnSfu(client, dto.channelId);

    await this.sfuService.setLayer(
      dto.channelId,
      client.id,
      dto.mid,
      dto.preferredRid,
    );

    return { status: 'updated', mid: dto.mid, preferredRid: dto.preferredRid };
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

  /** `assertInRoom`, plus the room must already be on the SFU. */
  private assertOnSfu(client: Socket, channelId: string): void {
    this.assertInRoom(client, channelId);

    if (this.topologyService.current(channelId) !== 'sfu') {
      throw new BadRequestException(
        'This voice channel is not on the media server',
      );
    }
  }

  /**
   * Moves a room onto the SFU and tells everyone in it to migrate — once: a
   * room already promoted stays silent. `except` is a joiner, who learns the
   * topology from its own ack instead.
   */
  private announcePromotion(channelId: string, except?: Socket): void {
    if (!this.topologyService.promote(channelId)) return;

    const payload = { channelId, topology: 'sfu' as const };

    if (except) {
      except.to(voiceRoom(channelId)).emit('voice:topology-changed', payload);
    } else {
      this.server
        .to(voiceRoom(channelId))
        .emit('voice:topology-changed', payload);
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
      await this.announceLeft(channelId, removed, remaining === 0);
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
  private async announceLeft(
    channelId: string,
    participant: VoiceParticipant,
    channelEmptied: boolean,
  ): Promise<void> {
    this.server.to(voiceRoom(channelId)).emit('voice:peer-left', {
      channelId,
      participant,
    });
    await this.broadcastPresence(participant.serverId, channelId);

    if (channelEmptied) this.topologyService.release(channelId);
  }

  /**
   * Pushes a channel's full roster to everyone watching its server. The whole
   * roster, not a delta: a watcher just replaces what it has, needs no join/
   * leave bookkeeping, and a missed event is repaired by the next one.
   */
  private async broadcastPresence(
    serverId: string,
    channelId: string,
  ): Promise<void> {
    this.server.to(serverRoom(serverId)).emit('voice:presence', {
      serverId,
      channelId,
      participants: await this.presence.listByChannel(channelId),
    });
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
    const topology = this.topologyService.current(channelId);

    return {
      channelId,
      selfId: user.sub,
      socketId: client.id,
      topology,
      participants,
      iceServers: await this.iceService.getIceServers(),
      bitrate: this.topologyService.bitrateFor(
        participants.length + 1,
        topology,
      ),
      video: this.topologyService.videoPolicy(),
    };
  }
}
