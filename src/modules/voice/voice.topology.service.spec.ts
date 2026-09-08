import { ConfigService } from '@nestjs/config';
import { VoiceConfig } from 'src/config/voice';
import { VoiceTopologyService } from './voice.topology.service';

const configWith = (overrides: Partial<VoiceConfig> = {}): ConfigService => {
  const config: VoiceConfig = {
    meshMax: 5,
    videoMeshMax: 2,
    maxAudioBitrate: 40_000,
    uplinkBudget: 200_000,
    turn: { static: { urls: [] }, ttl: 3600 },
    stunUrls: ['stun:example:3478'],
    ...overrides,
  };

  return { get: () => config } as unknown as ConfigService;
};

describe('VoiceTopologyService', () => {
  describe('decideForJoin', () => {
    it('keeps a room on the mesh up to and including the limit', () => {
      const topology = new VoiceTopologyService(configWith());

      expect(topology.decideForJoin('channel-a', 5)).toBe('mesh');
    });

    it('promotes a room that crosses the limit', () => {
      const topology = new VoiceTopologyService(configWith());

      expect(topology.decideForJoin('channel-a', 6)).toBe('sfu');
    });

    it('promotes one-way: a room that shrinks back stays promoted', () => {
      const topology = new VoiceTopologyService(configWith());
      topology.decideForJoin('channel-a', 6);

      // Without this, a room oscillating at the threshold renegotiates on
      // every join and leave, and each transition is an audible glitch.
      expect(topology.decideForJoin('channel-a', 3)).toBe('sfu');
      expect(topology.current('channel-a')).toBe('sfu');
    });

    it('promotes only the room that crossed the limit', () => {
      const topology = new VoiceTopologyService(configWith());
      topology.decideForJoin('channel-a', 6);

      expect(topology.current('channel-b')).toBe('mesh');
    });

    it('honours a configured limit', () => {
      const topology = new VoiceTopologyService(configWith({ meshMax: 2 }));

      expect(topology.decideForJoin('channel-a', 2)).toBe('mesh');
      expect(topology.decideForJoin('channel-a', 3)).toBe('sfu');
    });
  });

  it('hands an emptied room back to the mesh on release', () => {
    const topology = new VoiceTopologyService(configWith());
    topology.decideForJoin('channel-a', 6);

    topology.release('channel-a');

    expect(topology.current('channel-a')).toBe('mesh');
  });

  describe('bitrateFor', () => {
    it('gives the nominal ceiling to a lone participant', () => {
      const topology = new VoiceTopologyService(configWith());

      expect(topology.bitrateFor(1)).toEqual({ audio: { maxBitrate: 40_000 } });
    });

    it('keeps the nominal ceiling while the budget covers every peer', () => {
      const topology = new VoiceTopologyService(configWith());

      // 4 peers, 200k budget → 50k each, above the 40k Opus ceiling.
      expect(topology.bitrateFor(5)).toEqual({ audio: { maxBitrate: 40_000 } });
    });

    it('divides the uplink budget once it no longer covers every peer', () => {
      const topology = new VoiceTopologyService(
        configWith({ uplinkBudget: 90_000 }),
      );

      // A mesh sender encodes once per peer: 3 peers share 90k.
      expect(topology.bitrateFor(4)).toEqual({ audio: { maxBitrate: 30_000 } });
    });

    it('floors the division rather than emitting a fraction', () => {
      const topology = new VoiceTopologyService(
        configWith({ uplinkBudget: 100_000 }),
      );

      expect(topology.bitrateFor(4)).toEqual({ audio: { maxBitrate: 33_333 } });
    });
  });
});
