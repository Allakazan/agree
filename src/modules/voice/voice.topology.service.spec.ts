import { ConfigService } from '@nestjs/config';
import { VoiceConfig } from 'src/config/voice';
import { VoiceTopologyService } from './voice.topology.service';

const withSfu = { appId: 'app-id', appSecret: 'app-secret' };

const configWith = (overrides: Partial<VoiceConfig> = {}): ConfigService => {
  const config: VoiceConfig = {
    meshMax: 5,
    sfuMax: 25,
    maxAudioBitrate: 40_000,
    uplinkBudget: 200_000,
    turn: { static: { urls: [] }, ttl: 3600 },
    stunUrls: ['stun:example:3478'],
    sfu: {},
    ...overrides,
  };

  return { get: () => config } as unknown as ConfigService;
};

describe('VoiceTopologyService', () => {
  describe('needsSfu', () => {
    it('keeps an audio room on the mesh up to and including the limit', () => {
      const topology = new VoiceTopologyService(configWith());

      expect(topology.needsSfu(5)).toBe(false);
      expect(topology.needsSfu(6)).toBe(true);
    });

    it('sends any room with video to the SFU, whatever its size', () => {
      const topology = new VoiceTopologyService(configWith());

      // One topology per room: a video mesh beside an audio mesh would be two
      // transports and broken A/V sync.
      expect(topology.needsSfu(2, true)).toBe(true);
    });

    it('honours a configured limit', () => {
      const topology = new VoiceTopologyService(configWith({ meshMax: 2 }));

      expect(topology.needsSfu(2)).toBe(false);
      expect(topology.needsSfu(3)).toBe(true);
    });

    it('decides without promoting', () => {
      const topology = new VoiceTopologyService(configWith());

      topology.needsSfu(6);

      // A caller that refuses the join must not leave the room promoted.
      expect(topology.current('channel-a')).toBe('mesh');
    });
  });

  describe('promote', () => {
    it('reports the transition once, so it is announced once', () => {
      const topology = new VoiceTopologyService(configWith());

      expect(topology.promote('channel-a')).toBe(true);
      expect(topology.promote('channel-a')).toBe(false);
      expect(topology.current('channel-a')).toBe('sfu');
    });

    it('promotes only the room it was asked to', () => {
      const topology = new VoiceTopologyService(configWith());
      topology.promote('channel-a');

      expect(topology.current('channel-b')).toBe('mesh');
    });

    it('hands an emptied room back to the mesh on release', () => {
      const topology = new VoiceTopologyService(configWith());
      topology.promote('channel-a');

      topology.release('channel-a');

      expect(topology.current('channel-a')).toBe('mesh');
    });
  });

  describe('capacity', () => {
    it('is the mesh limit when there is no SFU to promote to', () => {
      const topology = new VoiceTopologyService(configWith());

      expect(topology.sfuEnabled).toBe(false);
      expect(topology.capacity).toBe(5);
    });

    it('is the SFU cap once an SFU is configured', () => {
      const topology = new VoiceTopologyService(configWith({ sfu: withSfu }));

      expect(topology.sfuEnabled).toBe(true);
      expect(topology.capacity).toBe(25);
    });

    it('never drops below the mesh limit', () => {
      const topology = new VoiceTopologyService(
        configWith({ sfu: withSfu, sfuMax: 3 }),
      );

      expect(topology.capacity).toBe(5);
    });

    it('needs both SFU credentials', () => {
      const topology = new VoiceTopologyService(
        configWith({ sfu: { appId: 'app-id' } }),
      );

      expect(topology.sfuEnabled).toBe(false);
    });
  });

  describe('bitrateFor', () => {
    it('gives the nominal ceiling to a lone participant', () => {
      const topology = new VoiceTopologyService(configWith());

      expect(topology.bitrateFor(1, 'mesh')).toEqual({
        audio: { maxBitrate: 40_000 },
      });
    });

    it('keeps the nominal ceiling while the budget covers every peer', () => {
      const topology = new VoiceTopologyService(configWith());

      // 4 peers, 200k budget → 50k each, above the 40k Opus ceiling.
      expect(topology.bitrateFor(5, 'mesh')).toEqual({
        audio: { maxBitrate: 40_000 },
      });
    });

    it('divides the uplink budget once it no longer covers every peer', () => {
      const topology = new VoiceTopologyService(
        configWith({ uplinkBudget: 90_000 }),
      );

      // A mesh sender encodes once per peer: 3 peers share 90k.
      expect(topology.bitrateFor(4, 'mesh')).toEqual({
        audio: { maxBitrate: 30_000 },
      });
    });

    it('floors the division rather than emitting a fraction', () => {
      const topology = new VoiceTopologyService(
        configWith({ uplinkBudget: 100_000 }),
      );

      expect(topology.bitrateFor(4, 'mesh')).toEqual({
        audio: { maxBitrate: 33_333 },
      });
    });

    it('never divides on the SFU, where a sender uploads once', () => {
      const topology = new VoiceTopologyService(
        configWith({ uplinkBudget: 90_000 }),
      );

      expect(topology.bitrateFor(10, 'sfu')).toEqual({
        audio: { maxBitrate: 40_000 },
      });
    });
  });

  describe('videoPolicy', () => {
    it('is null without an SFU: this server carries no video', () => {
      expect(new VoiceTopologyService(configWith()).videoPolicy()).toBeNull();
    });

    it('publishes the codecs and ladders once an SFU is configured', () => {
      const policy = new VoiceTopologyService(
        configWith({ sfu: withSfu }),
      ).videoPolicy();

      expect(policy?.codecs).toEqual(['VP8']);
      expect(
        policy?.profiles.screenDetail.encodings.map(({ rid }) => rid),
      ).toEqual(['f', 'h']);
    });
  });
});
