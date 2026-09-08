import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VoiceConfig } from 'src/config/voice';
import { VoiceBitratePolicy, VoiceTopology } from './types/voice.types';

/**
 * Decides where a room's media flows, and what bitrate ceiling its clients are
 * asked to respect.
 *
 * One topology **per room**, never per media kind: two thresholds evaluated
 * separately would put audio on the mesh and video on the SFU at the same time,
 * which means two transports, broken A/V sync and double the state.
 *
 * **Promotion is one-way.** A promoted room stays promoted until it empties.
 * A room oscillating around the threshold would otherwise renegotiate on every
 * join and leave, and each transition is an audible glitch. It also deletes the
 * harder half of the migration state machine — there is no demotion path to
 * write, only `release` when the last participant goes.
 */
@Injectable()
export class VoiceTopologyService {
  /** Channels that have crossed the mesh limit at least once since going empty. */
  private readonly promoted = new Set<string>();
  private readonly config: VoiceConfig;

  constructor(configService: ConfigService) {
    this.config = configService.get<VoiceConfig>('voice') as VoiceConfig;
  }

  get meshMax(): number {
    return this.config.meshMax;
  }

  /** The room's topology as it stands, without deciding anything. */
  current(channelId: string): VoiceTopology {
    return this.promoted.has(channelId) ? 'sfu' : 'mesh';
  }

  /**
   * The topology a room would have with `participantCount` people in it,
   * promoting it if that crosses the limit.
   *
   * Phase 2 adds the video clause here — `participantCount > videoMeshMax` once
   * anyone publishes video — together with the publisher tracking that feeds
   * it. There is no video to track yet, so the audio limit is the whole rule.
   */
  decideForJoin(channelId: string, participantCount: number): VoiceTopology {
    if (participantCount > this.config.meshMax) this.promoted.add(channelId);
    return this.current(channelId);
  }

  /** Called when a room empties: the next occupant starts back on the mesh. */
  release(channelId: string): void {
    this.promoted.delete(channelId);
  }

  /**
   * The ceiling a client should apply with `RTCRtpSender.setParameters()`.
   *
   * In a mesh a sender encodes and uploads once *per peer*, so the per-stream
   * ceiling has to divide the uplink budget by the number of peers being sent
   * to. Below that division the nominal Opus bitrate stands.
   *
   * This is a ceiling only. We do not implement adaptive bitrate — WebRTC's own
   * congestion control (GCC/TWCC) already adapts continuously — and simulcast
   * has no meaning in a mesh, where each `RTCPeerConnection` is independent and
   * the sender already encodes per receiver.
   */
  bitrateFor(participantCount: number): VoiceBitratePolicy {
    const { maxAudioBitrate, uplinkBudget } = this.config;

    const peers = participantCount - 1;
    if (peers < 1) return { audio: { maxBitrate: maxAudioBitrate } };

    return {
      audio: {
        maxBitrate: Math.min(maxAudioBitrate, Math.floor(uplinkBudget / peers)),
      },
    };
  }
}
