import { Logger } from '@nestjs/common';
import { VoiceSfuPublishTrackDto } from './dto/voice-sfu-publish.dto';
import { InMemoryVoicePresenceService } from './voice.presence.service';
import { SessionDescription } from './voice.sfu.client';
import { VoiceSfuService } from './voice.sfu.service';
import { VoiceParticipant } from './types/voice.types';

type Section = {
  mid: string;
  kind: 'audio' | 'video';
  codecs: string[];
  rids?: string[];
};

/** A minimal publish offer: one m-section per entry, rtx beside each video codec. */
const offer = (...sections: Section[]): SessionDescription => {
  const lines = ['v=0', 's=-', 't=0 0'];

  for (const { mid, kind, codecs, rids } of sections) {
    const rtpmaps = codecs.flatMap((codec, i) => {
      const pt = 96 + i * 2;
      const clock = kind === 'audio' ? '48000/2' : '90000';
      const primary = `a=rtpmap:${pt} ${codec}/${clock}`;
      return kind === 'video'
        ? [primary, `a=rtpmap:${pt + 1} rtx/90000`]
        : [primary];
    });

    lines.push(
      `m=${kind} 9 UDP/TLS/RTP/SAVPF 96`,
      `a=mid:${mid}`,
      'a=sendonly',
      ...rtpmaps,
      ...(rids?.length ? [`a=simulcast:send ${rids.join(';')}`] : []),
    );
  }

  return { type: 'offer', sdp: [...lines, ''].join('\r\n') };
};

const micSection = (mid = '0'): Section => ({
  mid,
  kind: 'audio',
  codecs: ['opus'],
});

const cameraSection = (mid = '1'): Section => ({
  mid,
  kind: 'video',
  codecs: ['VP8'],
  rids: ['f', 'h', 'q'],
});

const answer: SessionDescription = { type: 'answer', sdp: 'v=0 answer' };
const cfOffer: SessionDescription = { type: 'offer', sdp: 'v=0 cf offer' };
/** The client's offer after stopping the transceivers it is closing. */

describe('VoiceSfuService', () => {
  let service: VoiceSfuService;
  let presence: InMemoryVoicePresenceService;
  let client: {
    createSession: jest.Mock;
    pushTracks: jest.Mock;
    pullTracks: jest.Mock;
    renegotiate: jest.Mock;
    closeTracks: jest.Mock;
    updateTracks: jest.Mock;
  };

  const channelId = 'channel-id';

  const participant = (socketId: string, userId: string): VoiceParticipant => ({
    socketId,
    userId,
    username: userId,
    serverId: 'server-id',
    muted: false,
    deafened: false,
    joinedAt: '2026-09-13T12:00:00.000Z',
    tracks: [],
  });

  const publish = (
    socketId: string,
    description: SessionDescription,
    tracks: VoiceSfuPublishTrackDto[],
  ) => service.publish(channelId, socketId, description, tracks);

  /** Bento publishes a camera (and, optionally, a screen) on `session-bento`. */
  const bentoPublishes = async (
    extra: { section: Section; track: VoiceSfuPublishTrackDto }[] = [],
  ) => {
    client.createSession.mockResolvedValueOnce('session-bento');
    await publish(
      'socket-bento',
      offer(cameraSection('0'), ...extra.map((e) => e.section)),
      [{ mid: '0', source: 'camera' }, ...extra.map((e) => e.track)],
    );
    client.createSession.mockResolvedValueOnce('session-ana');
  };

  /** What Cloudflare echoes for a pull: the new mid on the puller's side. */
  const pulledAs = (mid: string, trackName: string) => ({
    sessionDescription: cfOffer,
    requiresImmediateRenegotiation: true,
    tracks: [{ mid, sessionId: 'session-bento', trackName }],
  });

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation();

    presence = new InMemoryVoicePresenceService();
    client = {
      createSession: jest.fn(),
      pushTracks: jest.fn().mockResolvedValue({ sessionDescription: answer }),
      pullTracks: jest.fn(),
      renegotiate: jest.fn().mockResolvedValue(undefined),
      closeTracks: jest.fn().mockResolvedValue({}),
      updateTracks: jest.fn().mockResolvedValue({}),
    };
    service = new VoiceSfuService(client as never, presence);

    await presence.add(channelId, participant('socket-ana', 'user-ana'));
    await presence.add(channelId, participant('socket-bento', 'user-bento'));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('publish', () => {
    it('forwards the offer, answers it and records the tracks', async () => {
      client.createSession.mockResolvedValue('session-ana');
      const description = offer(micSection(), cameraSection());

      const result = await publish('socket-ana', description, [
        { mid: '0', source: 'mic' },
        { mid: '1', source: 'camera' },
      ]);

      expect(client.pushTracks).toHaveBeenCalledWith(
        'session-ana',
        description,
        [
          { mid: '0', trackName: 'mic' },
          { mid: '1', trackName: 'camera' },
        ],
      );
      expect(result.sessionDescription).toEqual(answer);
      expect(result.tracks).toEqual([
        {
          mid: '0',
          track: { trackName: 'mic', source: 'mic', kind: 'audio', rids: [] },
        },
        {
          mid: '1',
          track: {
            trackName: 'camera',
            source: 'camera',
            kind: 'video',
            rids: ['f', 'h', 'q'],
          },
        },
      ]);
      expect(
        (await presence.get(channelId, 'socket-ana'))?.tracks.map(
          (t) => t.trackName,
        ),
      ).toEqual(['mic', 'camera']);
      expect(await presence.getSfuState(channelId, 'socket-ana')).toEqual({
        sessionId: 'session-ana',
        published: { '0': 'mic', '1': 'camera' },
        pulled: {},
      });
    });

    it('opens one session per socket, even for publishes fired together', async () => {
      client.createSession.mockResolvedValue('session-ana');

      await Promise.all([
        publish('socket-ana', offer(micSection()), [
          { mid: '0', source: 'mic' },
        ]),
        publish('socket-ana', offer(micSection(), cameraSection()), [
          { mid: '1', source: 'camera' },
        ]),
      ]);

      expect(client.createSession).toHaveBeenCalledTimes(1);
      expect(
        (await presence.getSfuState(channelId, 'socket-ana'))?.published,
      ).toEqual({ '0': 'mic', '1': 'camera' });
    });

    it('records the ladder a screenshare publishes, by content hint', async () => {
      client.createSession.mockResolvedValue('session-ana');

      const result = await publish(
        'socket-ana',
        offer({ mid: '0', kind: 'video', codecs: ['VP8'], rids: ['f', 'h'] }),
        [{ mid: '0', source: 'screen', contentHint: 'detail' }],
      );

      expect(result.tracks[0].track).toMatchObject({
        contentHint: 'detail',
        rids: ['f', 'h'],
      });
    });

    describe('rejects, without calling Cloudflare', () => {
      afterEach(() => {
        expect(client.createSession).not.toHaveBeenCalled();
        expect(client.pushTracks).not.toHaveBeenCalled();
      });

      it('a video codec outside the allowlist', async () => {
        await expect(
          publish(
            'socket-ana',
            offer({ ...cameraSection(), codecs: ['H264'] }),
            [{ mid: '1', source: 'camera' }],
          ),
        ).rejects.toThrow('A camera track must offer only VP8 (got h264)');
      });

      it('an allowed codec offered beside disallowed ones', async () => {
        // Only an offer of nothing but VP8 leaves Cloudflare no other choice.
        await expect(
          publish(
            'socket-ana',
            offer({ ...cameraSection(), codecs: ['VP8', 'VP9'] }),
            [{ mid: '1', source: 'camera' }],
          ),
        ).rejects.toThrow('must offer only VP8');
      });

      it('an audio codec outside the allowlist', async () => {
        await expect(
          publish(
            'socket-ana',
            offer({ ...micSection(), codecs: ['opus', 'G722'] }),
            [{ mid: '0', source: 'mic' }],
          ),
        ).rejects.toThrow('A mic track must offer only opus (got opus, g722)');
      });

      it('a text screenshare that simulcasts the unreadable 360p layer', async () => {
        await expect(
          publish(
            'socket-ana',
            offer({
              mid: '0',
              kind: 'video',
              codecs: ['VP8'],
              rids: ['f', 'h', 'q'],
            }),
            [{ mid: '0', source: 'screen', contentHint: 'detail' }],
          ),
        ).rejects.toThrow(
          'A screen track must simulcast exactly f;h (got f;h;q)',
        );
      });

      it('a video track without simulcast', async () => {
        await expect(
          publish('socket-ana', offer({ ...cameraSection(), rids: [] }), [
            { mid: '1', source: 'camera' },
          ]),
        ).rejects.toThrow('must simulcast exactly f;h;q (got none)');
      });

      it('a source whose media kind does not match its section', async () => {
        await expect(
          publish('socket-ana', offer(micSection('0')), [
            { mid: '0', source: 'camera' },
          ]),
        ).rejects.toThrow('A camera track must be video, but mid 0 is audio');
      });

      it('a mid the offer does not contain', async () => {
        await expect(
          publish('socket-ana', offer(micSection('0')), [
            { mid: '3', source: 'mic' },
          ]),
        ).rejects.toThrow('The offer has no media section for mid 3');
      });

      it('two tracks of the same source in one publish', async () => {
        await expect(
          publish('socket-ana', offer(micSection('0'), micSection('1')), [
            { mid: '0', source: 'mic' },
            { mid: '1', source: 'mic' },
          ]),
        ).rejects.toThrow('You are already publishing a mic track');
      });

      it('a socket that is not in the channel', async () => {
        await expect(
          publish('socket-stranger', offer(micSection()), [
            { mid: '0', source: 'mic' },
          ]),
        ).rejects.toThrow('You are not in this voice channel');
      });
    });

    it('refuses a second camera from the same socket', async () => {
      client.createSession.mockResolvedValue('session-ana');
      await publish('socket-ana', offer(cameraSection()), [
        { mid: '1', source: 'camera' },
      ]);

      await expect(
        publish('socket-ana', offer(cameraSection('2')), [
          { mid: '2', source: 'camera' },
        ]),
      ).rejects.toThrow('You are already publishing a camera track');
    });

    it('surfaces a Cloudflare failure generically and records nothing', async () => {
      client.createSession.mockResolvedValue('session-ana');
      client.pushTracks.mockRejectedValue(new Error('500 internal'));

      await expect(
        publish('socket-ana', offer(micSection()), [
          { mid: '0', source: 'mic' },
        ]),
      ).rejects.toThrow('The media server rejected the request');

      expect(await presence.getSfuState(channelId, 'socket-ana')).toBeNull();
      expect((await presence.get(channelId, 'socket-ana'))?.tracks).toEqual([]);
    });
  });

  describe('pull', () => {
    it("resolves the publisher's session through presence, on the cheapest layer", async () => {
      await bentoPublishes();
      client.pullTracks.mockResolvedValue(pulledAs('5', 'camera'));

      const result = await service.pull(channelId, 'socket-ana', [
        { userId: 'user-bento', trackName: 'camera' },
      ]);

      expect(client.pullTracks).toHaveBeenCalledWith('session-ana', [
        {
          sessionId: 'session-bento',
          trackName: 'camera',
          simulcast: {
            preferredRid: 'q',
            priorityOrdering: 'asciibetical',
            ridNotAvailable: 'asciibetical',
          },
        },
      ]);
      expect(result).toEqual({
        sessionDescription: cfOffer,
        requiresImmediateRenegotiation: true,
        tracks: [{ mid: '5', userId: 'user-bento', trackName: 'camera' }],
      });
      expect(
        (await presence.getSfuState(channelId, 'socket-ana'))?.pulled,
      ).toEqual({
        '5': {
          publisherSocketId: 'socket-bento',
          publisherUserId: 'user-bento',
          trackName: 'camera',
        },
      });
    });

    it('honours a preferred layer the track offers', async () => {
      await bentoPublishes();
      client.pullTracks.mockResolvedValue(pulledAs('5', 'camera'));

      await service.pull(channelId, 'socket-ana', [
        { userId: 'user-bento', trackName: 'camera', preferredRid: 'f' },
      ]);

      expect(client.pullTracks).toHaveBeenCalledWith('session-ana', [
        expect.objectContaining({
          simulcast: expect.objectContaining({ preferredRid: 'f' }) as unknown,
        }),
      ]);
    });

    it('sends no simulcast block for audio', async () => {
      await bentoPublishes([
        { section: micSection('1'), track: { mid: '1', source: 'mic' } },
      ]);
      client.pullTracks.mockResolvedValue(pulledAs('5', 'mic'));

      await service.pull(channelId, 'socket-ana', [
        { userId: 'user-bento', trackName: 'mic' },
      ]);

      expect(client.pullTracks).toHaveBeenCalledWith('session-ana', [
        { sessionId: 'session-bento', trackName: 'mic' },
      ]);
    });

    describe('rejects, without calling Cloudflare', () => {
      beforeEach(async () => {
        await bentoPublishes([
          {
            section: {
              mid: '1',
              kind: 'video',
              codecs: ['VP8'],
              rids: ['f', 'h'],
            },
            track: { mid: '1', source: 'screen', contentHint: 'detail' },
          },
        ]);
      });

      afterEach(() => {
        expect(client.pullTracks).not.toHaveBeenCalled();
      });

      it('your own track', async () => {
        await expect(
          service.pull(channelId, 'socket-bento', [
            { userId: 'user-bento', trackName: 'camera' },
          ]),
        ).rejects.toThrow('Cannot pull your own track');
      });

      it('a publisher who is not in the channel', async () => {
        await expect(
          service.pull(channelId, 'socket-ana', [
            { userId: 'user-stranger', trackName: 'camera' },
          ]),
        ).rejects.toThrow('That peer is not in this voice channel');
      });

      it('a track the publisher is not publishing', async () => {
        await expect(
          service.pull(channelId, 'socket-ana', [
            { userId: 'user-bento', trackName: 'mic' },
          ]),
        ).rejects.toThrow('That peer is not publishing mic');
      });

      it('a layer the track does not offer', async () => {
        await expect(
          service.pull(channelId, 'socket-ana', [
            { userId: 'user-bento', trackName: 'screen', preferredRid: 'q' },
          ]),
        ).rejects.toThrow('Layer q is not available on that track (f, h)');
      });

      it('the same track twice in one request', async () => {
        await expect(
          service.pull(channelId, 'socket-ana', [
            { userId: 'user-bento', trackName: 'camera' },
            { userId: 'user-bento', trackName: 'camera' },
          ]),
        ).rejects.toThrow('You are already receiving camera from that peer');
      });
    });

    it('refuses a track this socket already receives', async () => {
      await bentoPublishes();
      client.pullTracks.mockResolvedValue(pulledAs('5', 'camera'));
      await service.pull(channelId, 'socket-ana', [
        { userId: 'user-bento', trackName: 'camera' },
      ]);

      // A client re-pulling on every render would multiply the egress bill.
      await expect(
        service.pull(channelId, 'socket-ana', [
          { userId: 'user-bento', trackName: 'camera' },
        ]),
      ).rejects.toThrow('You are already receiving camera from that peer');
      expect(client.pullTracks).toHaveBeenCalledTimes(1);
    });
  });

  describe('close', () => {
    it('unpublishes a closed local track', async () => {
      client.createSession.mockResolvedValue('session-ana');
      await publish('socket-ana', offer(micSection(), cameraSection()), [
        { mid: '0', source: 'mic' },
        { mid: '1', source: 'camera' },
      ]);

      const result = await service.close(channelId, 'socket-ana', ['1']);

      expect(client.closeTracks).toHaveBeenCalledWith('session-ana', ['1']);
      expect(result.unpublished).toEqual(['camera']);
      expect(
        (await presence.get(channelId, 'socket-ana'))?.tracks.map(
          (t) => t.trackName,
        ),
      ).toEqual(['mic']);
      expect(
        (await presence.getSfuState(channelId, 'socket-ana'))?.published,
      ).toEqual({ '0': 'mic' });
    });

    it('lets a closed pull be pulled again', async () => {
      await bentoPublishes();
      client.pullTracks.mockResolvedValue(pulledAs('5', 'camera'));
      await service.pull(channelId, 'socket-ana', [
        { userId: 'user-bento', trackName: 'camera' },
      ]);

      const result = await service.close(channelId, 'socket-ana', ['5']);
      await service.pull(channelId, 'socket-ana', [
        { userId: 'user-bento', trackName: 'camera' },
      ]);

      expect(result.unpublished).toEqual([]);
      expect(client.pullTracks).toHaveBeenCalledTimes(2);
    });

    it('refuses a mid this socket neither publishes nor pulls', async () => {
      client.createSession.mockResolvedValue('session-ana');
      await publish('socket-ana', offer(micSection()), [
        { mid: '0', source: 'mic' },
      ]);

      await expect(
        service.close(channelId, 'socket-ana', ['9']),
      ).rejects.toThrow('Unknown track mid 9');
      expect(client.closeTracks).not.toHaveBeenCalled();
    });

    it('refuses a socket with no session yet', async () => {
      await expect(
        service.close(channelId, 'socket-ana', ['0']),
      ).rejects.toThrow('You have no media session yet');
    });
  });

  describe('setLayer', () => {
    beforeEach(async () => {
      await bentoPublishes();
      client.pullTracks.mockResolvedValue(pulledAs('5', 'camera'));
      await service.pull(channelId, 'socket-ana', [
        { userId: 'user-bento', trackName: 'camera' },
      ]);
    });

    it('moves a pull to another layer of the same track', async () => {
      await service.setLayer(channelId, 'socket-ana', '5', 'f');

      expect(client.updateTracks).toHaveBeenCalledWith('session-ana', [
        {
          location: 'remote',
          mid: '5',
          sessionId: 'session-bento',
          trackName: 'camera',
          simulcast: {
            preferredRid: 'f',
            priorityOrdering: 'asciibetical',
            ridNotAvailable: 'asciibetical',
          },
        },
      ]);
    });

    it('refuses a mid this socket does not pull', async () => {
      await expect(
        service.setLayer(channelId, 'socket-ana', '9', 'f'),
      ).rejects.toThrow('Unknown track mid 9');
    });

    it('refuses once the publisher has left', async () => {
      await presence.remove(channelId, 'socket-bento');

      await expect(
        service.setLayer(channelId, 'socket-ana', '5', 'f'),
      ).rejects.toThrow('That peer is no longer in this voice channel');
      expect(client.updateTracks).not.toHaveBeenCalled();
    });
  });

  describe('renegotiate', () => {
    it("answers Cloudflare's offer on the socket's own session", async () => {
      await bentoPublishes();
      client.pullTracks.mockResolvedValue(pulledAs('5', 'camera'));
      await service.pull(channelId, 'socket-ana', [
        { userId: 'user-bento', trackName: 'camera' },
      ]);

      await service.renegotiate(channelId, 'socket-ana', answer);

      expect(client.renegotiate).toHaveBeenCalledWith('session-ana', answer);
    });

    it('refuses a socket with no session yet', async () => {
      await expect(
        service.renegotiate(channelId, 'socket-ana', answer),
      ).rejects.toThrow('You have no media session yet');
    });
  });
});
