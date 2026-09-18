import { Test } from '@nestjs/testing';
import { BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggedUser } from 'src/modules/auth/types/loggedUser.type';
import { AuthGuard } from 'src/modules/auth/guards/auth.guard';
import { WsAuthService } from 'src/modules/auth/ws-auth.service';
import { VoiceConfig } from 'src/config/voice';
import { ChannelType } from '../server/schemas/channel.schema';
import { ServerService } from '../server/server.service';
import { VoiceGateway } from './voice.gateway';
import { VoiceIceService } from './voice.ice.service';
import { VOICE_PRESENCE_STORE } from './voice.presence.interface';
import { InMemoryVoicePresenceService } from './voice.presence.service';
import { CloudflareSfuClient, SessionDescription } from './voice.sfu.client';
import { VoiceSfuService } from './voice.sfu.service';
import { VoiceTopologyService } from './voice.topology.service';
import { VoiceSignalDto, VoiceSignalKind } from './dto/voice-signal.dto';
import { VoiceParticipant } from './types/voice.types';

type TestClient = {
  id: string;
  rooms: Set<string>;
  join: jest.Mock;
  leave: jest.Mock;
  emit: jest.Mock;
  disconnect: jest.Mock;
  to: jest.Mock;
  /** Everything this socket broadcast to a room, i.e. `client.to(room).emit`. */
  roomEmit: jest.Mock;
  data: { user?: LoggedUser };
};

const makeClient = (id: string): TestClient => {
  const rooms = new Set<string>();
  const roomEmit = jest.fn();

  return {
    id,
    rooms,
    join: jest.fn((room: string) => {
      rooms.add(room);
      return Promise.resolve();
    }),
    leave: jest.fn((room: string) => {
      rooms.delete(room);
      return Promise.resolve();
    }),
    emit: jest.fn(),
    disconnect: jest.fn(),
    to: jest.fn(() => ({ emit: roomEmit })),
    roomEmit,
    data: {},
  };
};

const asSocket = (client: TestClient) => client as never;

/** `expect.objectContaining`, typed, so it can sit in a typed payload shape. */
const participantLike = (shape: Partial<VoiceParticipant>): VoiceParticipant =>
  expect.objectContaining(shape) as VoiceParticipant;

/** A publish offer for a VP8 camera simulcasting the full ladder. */
const cameraOffer = (mid = '0'): SessionDescription => ({
  type: 'offer',
  sdp: [
    'v=0',
    'm=video 9 UDP/TLS/RTP/SAVPF 96 97',
    `a=mid:${mid}`,
    'a=rtpmap:96 VP8/90000',
    'a=rtpmap:97 rtx/90000',
    'a=simulcast:send f;h;q',
    '',
  ].join('\r\n'),
});

const micOffer = (mid = '0'): SessionDescription => ({
  type: 'offer',
  sdp: [
    'v=0',
    'm=audio 9 UDP/TLS/RTP/SAVPF 111',
    `a=mid:${mid}`,
    'a=rtpmap:111 opus/48000/2',
    '',
  ].join('\r\n'),
});

describe('VoiceGateway', () => {
  let gateway: VoiceGateway;
  let presence: InMemoryVoicePresenceService;
  let serverService: { findChannelForMember: jest.Mock };
  let wsAuthService: { authenticate: jest.Mock };
  let iceService: { getIceServers: jest.Mock };
  let cfClient: {
    createSession: jest.Mock;
    pushTracks: jest.Mock;
    pullTracks: jest.Mock;
    renegotiate: jest.Mock;
    closeTracks: jest.Mock;
    updateTracks: jest.Mock;
  };
  /** Everything the *server* broadcast, i.e. `server.to(target).emit`. */
  let serverEmit: jest.Mock;
  let serverTo: jest.Mock;
  let serverIn: jest.Mock;
  let disconnectSockets: jest.Mock;

  const ana: LoggedUser = { sub: 'user-ana', username: 'ana' };
  const bento: LoggedUser = { sub: 'user-bento', username: 'bento' };
  const channelId = 'channel-id';
  const room = 'voice:channel-id';
  const iceServers = [{ urls: ['stun:stun.example:3478'] }];

  type SetupOptions = { meshMax?: number; sfuMax?: number; sfu?: boolean };

  const voiceConfig = ({
    meshMax = 5,
    sfuMax = 25,
    sfu = false,
  }: SetupOptions): VoiceConfig => ({
    meshMax,
    sfuMax,
    maxAudioBitrate: 40_000,
    uplinkBudget: 200_000,
    turn: { static: { urls: [] }, ttl: 3600 },
    stunUrls: ['stun:stun.example:3478'],
    sfu: sfu ? { appId: 'app-id', appSecret: 'app-secret' } : {},
  });

  const setup = async (options: SetupOptions = {}) => {
    presence = new InMemoryVoicePresenceService();
    serverService = { findChannelForMember: jest.fn() };
    wsAuthService = { authenticate: jest.fn() };
    iceService = { getIceServers: jest.fn().mockResolvedValue(iceServers) };
    let sessions = 0;
    cfClient = {
      createSession: jest.fn(() => Promise.resolve(`session-${++sessions}`)),
      pushTracks: jest.fn().mockResolvedValue({
        sessionDescription: { type: 'answer', sdp: 'v=0 answer' },
      }),
      pullTracks: jest.fn(),
      renegotiate: jest.fn().mockResolvedValue(undefined),
      closeTracks: jest.fn().mockResolvedValue({}),
      updateTracks: jest.fn().mockResolvedValue({}),
    };

    const module = await Test.createTestingModule({
      providers: [
        VoiceGateway,
        VoiceTopologyService,
        // The real orchestration over a fake Cloudflare: authorization and
        // bookkeeping are what these tests are about.
        VoiceSfuService,
        { provide: CloudflareSfuClient, useValue: cfClient },
        {
          provide: ConfigService,
          useValue: { get: () => voiceConfig(options) },
        },
        { provide: ServerService, useValue: serverService },
        { provide: WsAuthService, useValue: wsAuthService },
        { provide: VoiceIceService, useValue: iceService },
        // The real store: presence is most of what this gateway does, and
        // asserting against a mock of it would assert nothing.
        { provide: VOICE_PRESENCE_STORE, useValue: presence },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    gateway = module.get(VoiceGateway);

    serverEmit = jest.fn();
    serverTo = jest.fn(() => ({ emit: serverEmit }));
    disconnectSockets = jest.fn();
    serverIn = jest.fn(() => ({ disconnectSockets }));
    gateway.server = { to: serverTo, in: serverIn } as never;

    serverService.findChannelForMember.mockResolvedValue({
      name: 'geral',
      type: ChannelType.VOICE,
    });
  };

  const join = (client: TestClient, user: LoggedUser) =>
    gateway.handleJoin({ channelId }, asSocket(client), user);

  beforeEach(async () => {
    await setup();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('handleConnection', () => {
    it('attaches the user to the socket when the handshake is authenticated', async () => {
      const client = makeClient('socket-1');
      wsAuthService.authenticate.mockResolvedValue(ana);

      await gateway.handleConnection(asSocket(client));

      expect(client.data.user).toEqual(ana);
      expect(client.disconnect).not.toHaveBeenCalled();
    });

    it('emits an error and disconnects an unauthenticated socket', async () => {
      const client = makeClient('socket-1');
      wsAuthService.authenticate.mockResolvedValue(null);

      await gateway.handleConnection(asSocket(client));

      expect(client.emit).toHaveBeenCalledWith('error', {
        status: 'error',
        message: 'Unauthorized',
      });
      expect(client.disconnect).toHaveBeenCalledWith(true);
    });
  });

  describe('voice:join', () => {
    it('joins the room, records presence and acks with everything needed to connect', async () => {
      const client = makeClient('socket-1');

      const ack = await join(client, ana);

      expect(serverService.findChannelForMember).toHaveBeenCalledWith(
        'user-ana',
        channelId,
      );
      expect(client.join).toHaveBeenCalledWith(room);
      expect(ack).toEqual({
        channelId,
        selfId: 'user-ana',
        socketId: 'socket-1',
        topology: 'mesh',
        participants: [],
        iceServers,
        bitrate: { audio: { maxBitrate: 40_000 } },
        // No SFU configured in this setup: the server carries no video.
        video: null,
      });
      expect(await presence.countByChannel(channelId)).toBe(1);
    });

    it('hands a newcomer the existing participants and announces it to them', async () => {
      const ana1 = makeClient('socket-1');
      const bento1 = makeClient('socket-2');
      await join(ana1, ana);

      const ack = await join(bento1, bento);

      // The newcomer offers to each of these; they only ever answer.
      expect(ack.participants).toEqual([
        expect.objectContaining({ userId: 'user-ana', socketId: 'socket-1' }),
      ]);
      expect(bento1.to).toHaveBeenCalledWith(room);
      expect(bento1.roomEmit).toHaveBeenCalledWith('voice:peer-joined', {
        channelId,
        participant: participantLike({ userId: 'user-bento' }),
      });
    });

    it('rejects a user who is not a member of the channel server', async () => {
      const client = makeClient('socket-1');
      serverService.findChannelForMember.mockResolvedValue(null);

      await expect(join(client, ana)).rejects.toThrow(BadRequestException);
      expect(client.join).not.toHaveBeenCalled();
      expect(await presence.countByChannel(channelId)).toBe(0);
    });

    it('rejects a text channel', async () => {
      const client = makeClient('socket-1');
      serverService.findChannelForMember.mockResolvedValue({
        name: 'geral',
        type: ChannelType.TEXT,
      });

      await expect(join(client, ana)).rejects.toThrow(
        'This channel is not a voice channel',
      );
      expect(client.join).not.toHaveBeenCalled();
    });

    it('rejects a join past the mesh limit when there is no SFU to promote to', async () => {
      await setup({ meshMax: 1 });
      const ana1 = makeClient('socket-1');
      const bento1 = makeClient('socket-2');
      await join(ana1, ana);

      await expect(join(bento1, bento)).rejects.toThrow(
        'This voice channel is full (1 participants)',
      );
      expect(bento1.join).not.toHaveBeenCalled();
      expect(await presence.countByChannel(channelId)).toBe(1);
      // A refused join must not leave the room reporting `sfu` to everyone.
      expect(gateway['topologyService'].current(channelId)).toBe('mesh');
    });

    describe('with an SFU configured', () => {
      it('promotes the room instead of refusing the joiner past the mesh limit', async () => {
        await setup({ meshMax: 1, sfu: true });
        const ana1 = makeClient('socket-1');
        const bento1 = makeClient('socket-2');
        await join(ana1, ana);

        const ack = await join(bento1, bento);

        expect(ack.topology).toBe('sfu');
        expect(ack.video?.codecs).toEqual(['VP8']);
        // Existing members migrate; the joiner learns it from its own ack.
        expect(bento1.roomEmit).toHaveBeenCalledWith('voice:topology-changed', {
          channelId,
          topology: 'sfu',
        });
      });

      it('announces the promotion once, not on every later join', async () => {
        await setup({ meshMax: 1, sfu: true });
        await join(makeClient('socket-1'), ana);
        await join(makeClient('socket-2'), bento);
        const carol1 = makeClient('socket-3');

        await join(carol1, { sub: 'user-carol', username: 'carol' });

        expect(carol1.roomEmit).not.toHaveBeenCalledWith(
          'voice:topology-changed',
          expect.anything(),
        );
      });

      it('refuses a joiner past the SFU cap', async () => {
        await setup({ meshMax: 1, sfuMax: 2, sfu: true });
        await join(makeClient('socket-1'), ana);
        await join(makeClient('socket-2'), bento);

        await expect(
          join(makeClient('socket-3'), {
            sub: 'user-carol',
            username: 'carol',
          }),
        ).rejects.toThrow('This voice channel is full (2 participants)');
      });
    });

    it('re-acks an already joined socket without announcing it twice', async () => {
      const client = makeClient('socket-1');
      await join(client, ana);
      client.roomEmit.mockClear();

      const ack = await join(client, ana);

      expect(ack.participants).toEqual([]);
      expect(client.roomEmit).not.toHaveBeenCalled();
      expect(await presence.countByChannel(channelId)).toBe(1);
    });

    it("evicts the user's earlier socket, so a second tab cannot hear itself", async () => {
      const first = makeClient('socket-1');
      const second = makeClient('socket-2');
      await join(first, ana);

      await join(second, ana);

      expect(serverTo).toHaveBeenCalledWith('socket-1');
      expect(serverEmit).toHaveBeenCalledWith('voice:evicted', {
        channelId,
        reason: 'joined-from-another-device',
      });
      expect(serverIn).toHaveBeenCalledWith('socket-1');
      expect(disconnectSockets).toHaveBeenCalledWith(true);
      // Presence is cleared here rather than left to the disconnect handler,
      // so the newcomer's roster cannot list a peer on its way out.
      expect(await presence.listByChannel(channelId)).toEqual([
        expect.objectContaining({ socketId: 'socket-2' }),
      ]);
    });
  });

  describe('voice:leave', () => {
    it('drops presence and broadcasts the departure', async () => {
      const client = makeClient('socket-1');
      await join(client, ana);

      const result = await gateway.handleLeave({ channelId }, asSocket(client));

      expect(client.leave).toHaveBeenCalledWith(room);
      expect(serverTo).toHaveBeenCalledWith(room);
      expect(serverEmit).toHaveBeenCalledWith('voice:peer-left', {
        channelId,
        participant: participantLike({ socketId: 'socket-1' }),
      });
      expect(result).toEqual({ status: 'left', channelId });
      expect(await presence.countByChannel(channelId)).toBe(0);
    });

    it('stays quiet when the socket was never in the channel', async () => {
      const client = makeClient('socket-1');

      await gateway.handleLeave({ channelId }, asSocket(client));

      expect(serverEmit).not.toHaveBeenCalled();
    });
  });

  describe('voice:signal', () => {
    const signal = (
      client: TestClient,
      user: LoggedUser,
      targetUserId: string,
    ) => {
      const dto: VoiceSignalDto = {
        channelId,
        targetUserId,
        kind: VoiceSignalKind.OFFER,
        payload: { sdp: 'v=0' },
      };
      return gateway.handleSignal(dto, asSocket(client), user);
    };

    it('relays to the target peer socket, untouched', async () => {
      const ana1 = makeClient('socket-1');
      const bento1 = makeClient('socket-2');
      await join(ana1, ana);
      await join(bento1, bento);

      const result = await signal(bento1, bento, 'user-ana');

      expect(serverTo).toHaveBeenCalledWith('socket-1');
      expect(serverEmit).toHaveBeenCalledWith('voice:signal', {
        channelId,
        fromUserId: 'user-bento',
        kind: 'offer',
        payload: { sdp: 'v=0' },
      });
      expect(result).toEqual({ status: 'sent' });
    });

    it('rejects a sender that never joined, and does not repair its membership', async () => {
      const client = makeClient('socket-1');

      await expect(signal(client, bento, 'user-ana')).rejects.toThrow(
        'Join this voice channel first',
      );
      // Presence in the room *is* the authorization: joining here would hand
      // the room to whoever asked for it.
      expect(client.join).not.toHaveBeenCalled();
      expect(serverEmit).not.toHaveBeenCalled();
    });

    it('rejects a target that is not in the channel', async () => {
      const client = makeClient('socket-1');
      await join(client, ana);

      await expect(signal(client, ana, 'user-stranger')).rejects.toThrow(
        'That peer is not in this voice channel',
      );
    });

    it('rejects signalling yourself', async () => {
      const client = makeClient('socket-1');
      await join(client, ana);

      await expect(signal(client, ana, 'user-ana')).rejects.toThrow(
        'Cannot signal yourself',
      );
    });

    it('rejects mesh signalling in a room that has moved onto the SFU', async () => {
      await setup({ meshMax: 1, sfu: true });
      const ana1 = makeClient('socket-1');
      const bento1 = makeClient('socket-2');
      await join(ana1, ana);
      await join(bento1, bento);

      // A mesh-only client must not keep running P2P past the limit.
      await expect(signal(bento1, bento, 'user-ana')).rejects.toThrow(
        'This voice channel is on the media server, not peer to peer',
      );
      expect(serverEmit).not.toHaveBeenCalledWith(
        'voice:signal',
        expect.anything(),
      );
    });
  });

  describe('voice:state', () => {
    it('stores mute state and broadcasts it to the room', async () => {
      const client = makeClient('socket-1');
      await join(client, ana);

      const participant = await gateway.handleState(
        { channelId, muted: true, deafened: false },
        asSocket(client),
      );

      expect(participant).toMatchObject({ muted: true, deafened: false });
      expect(client.roomEmit).toHaveBeenCalledWith('voice:state-changed', {
        channelId,
        participant: participantLike({ muted: true }),
      });
      // Stored, so a late joiner renders the right icons.
      expect((await presence.listByChannel(channelId))[0].muted).toBe(true);
    });

    it('rejects a socket that is not in the room', async () => {
      const client = makeClient('socket-1');

      await expect(
        gateway.handleState(
          { channelId, muted: true, deafened: false },
          asSocket(client),
        ),
      ).rejects.toThrow('Join this voice channel first');
    });
  });

  describe('handleDisconnect', () => {
    it('clears presence and broadcasts the departure', async () => {
      const client = makeClient('socket-1');
      await join(client, ana);

      await gateway.handleDisconnect(asSocket(client));

      expect(serverTo).toHaveBeenCalledWith(room);
      expect(serverEmit).toHaveBeenCalledWith('voice:peer-left', {
        channelId,
        participant: participantLike({ socketId: 'socket-1' }),
      });
      expect(await presence.countByChannel(channelId)).toBe(0);
    });

    it('does nothing for a socket that never joined a channel', async () => {
      const client = makeClient('socket-1');

      await gateway.handleDisconnect(asSocket(client));

      expect(serverEmit).not.toHaveBeenCalled();
    });

    it('releases an emptied room back to the mesh', async () => {
      const client = makeClient('socket-1');
      await join(client, ana);
      const topology = gateway['topologyService'];
      topology.promote(channelId);

      await gateway.handleDisconnect(asSocket(client));

      expect(topology.current(channelId)).toBe('mesh');
    });
  });

  describe('SFU', () => {
    const publishCamera = (client: TestClient, user: LoggedUser) =>
      gateway.handleSfuPublish(
        {
          channelId,
          sessionDescription: cameraOffer() as never,
          tracks: [{ mid: '0', source: 'camera' }],
        },
        asSocket(client),
        user,
      );

    /** Every payload that left the server: broadcasts, room emits and acks. */
    const everythingEmitted = (clients: TestClient[], acks: unknown[]) =>
      JSON.stringify([
        serverEmit.mock.calls,
        ...clients.map((client) => client.roomEmit.mock.calls as unknown[]),
        ...clients.map((client) => client.emit.mock.calls as unknown[]),
        acks,
      ]);

    let ana1: TestClient;
    let bento1: TestClient;

    beforeEach(async () => {
      await setup({ sfu: true });
      ana1 = makeClient('socket-1');
      bento1 = makeClient('socket-2');
      await join(ana1, ana);
      await join(bento1, bento);
    });

    describe('voice:sfu:publish', () => {
      it('takes a mesh room onto the SFU with its first video publisher', async () => {
        const ack = await publishCamera(ana1, ana);

        expect(ack).toEqual({
          sessionDescription: { type: 'answer', sdp: 'v=0 answer' },
          tracks: [{ mid: '0', trackName: 'camera' }],
        });
        expect(gateway['topologyService'].current(channelId)).toBe('sfu');
        expect(serverTo).toHaveBeenCalledWith(room);
        expect(serverEmit).toHaveBeenCalledWith('voice:topology-changed', {
          channelId,
          topology: 'sfu',
        });
        expect(ana1.roomEmit).toHaveBeenCalledWith('voice:track-published', {
          channelId,
          userId: 'user-ana',
          track: {
            trackName: 'camera',
            source: 'camera',
            kind: 'video',
            rids: ['f', 'h', 'q'],
          },
        });
      });

      it('announces the promotion once, however many publish video', async () => {
        await publishCamera(ana1, ana);
        await publishCamera(bento1, bento);

        const promotions = serverEmit.mock.calls.filter(
          ([event]) => event === 'voice:topology-changed',
        );
        expect(promotions).toHaveLength(1);
      });

      it('leaves the room on the mesh when Cloudflare refuses the publish', async () => {
        jest.spyOn(Logger.prototype, 'error').mockImplementation();
        cfClient.pushTracks.mockRejectedValue(new Error('503'));

        await expect(publishCamera(ana1, ana)).rejects.toThrow(
          'The media server rejected the request',
        );
        expect(gateway['topologyService'].current(channelId)).toBe('mesh');
        expect(serverEmit).not.toHaveBeenCalledWith(
          'voice:topology-changed',
          expect.anything(),
        );
      });

      it('refuses audio-only publishing on a mesh room', async () => {
        await expect(
          gateway.handleSfuPublish(
            {
              channelId,
              sessionDescription: micOffer() as never,
              tracks: [{ mid: '0', source: 'mic' }],
            },
            asSocket(ana1),
            ana,
          ),
        ).rejects.toThrow(
          'This voice channel is peer to peer; audio goes over voice:signal',
        );
        expect(cfClient.pushTracks).not.toHaveBeenCalled();
      });

      it('refuses video when no SFU is configured', async () => {
        await setup();
        const client = makeClient('socket-1');
        await join(client, ana);

        await expect(publishCamera(client, ana)).rejects.toThrow(
          'Video is not available on this server',
        );
      });

      it('rejects a socket that never joined, and does not repair its membership', async () => {
        const stranger = makeClient('socket-9');

        await expect(publishCamera(stranger, ana)).rejects.toThrow(
          'Join this voice channel first',
        );
        expect(stranger.join).not.toHaveBeenCalled();
        expect(cfClient.createSession).not.toHaveBeenCalled();
      });
    });

    describe('voice:sfu:pull', () => {
      it('refuses a room that is still on the mesh', async () => {
        await expect(
          gateway.handleSfuPull(
            { channelId, tracks: [{ userId: 'user-bento', trackName: 'mic' }] },
            asSocket(ana1),
          ),
        ).rejects.toThrow('This voice channel is not on the media server');
      });

      it('rejects a socket that never joined, and does not repair its membership', async () => {
        await publishCamera(bento1, bento);
        const stranger = makeClient('socket-9');

        await expect(
          gateway.handleSfuPull(
            {
              channelId,
              tracks: [{ userId: 'user-bento', trackName: 'camera' }],
            },
            asSocket(stranger),
          ),
        ).rejects.toThrow('Join this voice channel first');
        expect(stranger.join).not.toHaveBeenCalled();
        expect(cfClient.pullTracks).not.toHaveBeenCalled();
      });

      it('never lets a Cloudflare session id leave the server', async () => {
        await publishCamera(bento1, bento);
        cfClient.pullTracks.mockImplementation(
          (
            _session: string,
            tracks: { sessionId: string; trackName: string }[],
          ) =>
            Promise.resolve({
              sessionDescription: { type: 'offer', sdp: 'v=0 cf offer' },
              requiresImmediateRenegotiation: true,
              tracks: tracks.map((track, i) => ({ ...track, mid: `${i + 5}` })),
            }),
        );

        const pullAck = await gateway.handleSfuPull(
          {
            channelId,
            tracks: [{ userId: 'user-bento', trackName: 'camera' }],
          },
          asSocket(ana1),
        );
        const rejoinAck = await join(ana1, ana);

        // The pull did reach Cloudflare with bento's session...
        expect(cfClient.pullTracks).toHaveBeenCalledWith(expect.any(String), [
          expect.objectContaining({ sessionId: 'session-1' }),
        ]);
        // ...but no payload a client can see carries one.
        expect(
          everythingEmitted([ana1, bento1], [pullAck, rejoinAck]),
        ).not.toMatch(/session-\d/);
      });
    });

    describe('voice:sfu:close', () => {
      it('takes a closed camera off the room', async () => {
        await publishCamera(ana1, ana);

        await gateway.handleSfuClose(
          { channelId, mids: ['0'] },
          asSocket(ana1),
          ana,
        );

        expect(ana1.roomEmit).toHaveBeenCalledWith('voice:track-unpublished', {
          channelId,
          userId: 'user-ana',
          trackName: 'camera',
        });
        expect(
          (await presence.findByUser(channelId, 'user-ana'))?.tracks,
        ).toEqual([]);
      });
    });

    it('clears SFU state with the rest of presence on disconnect', async () => {
      await publishCamera(ana1, ana);

      await gateway.handleDisconnect(asSocket(ana1));

      expect(await presence.getSfuState(channelId, 'socket-1')).toBeNull();
      expect(serverEmit).toHaveBeenCalledWith('voice:peer-left', {
        channelId,
        participant: participantLike({ socketId: 'socket-1' }),
      });
    });
  });
});
