import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VoiceConfig } from 'src/config/voice';
import { VIDEO_POLICY } from './voice.simulcast';
import {
  VoiceBitratePolicy,
  VoiceTopology,
  VoiceVideoPolicy,
} from './types/voice.types';

/**
 * Decides where a room's media flows, and what ceilings its clients are asked
 * to respect.
 *
 * One topology **per room**, never per media kind: two thresholds evaluated
 * separately would put audio on the mesh and video on the SFU at the same time,
 * which means two transports, broken A/V sync and double the state. So video
 * does not get a mesh of its own — the first video publisher takes the whole
 * room onto the SFU, and the mesh stays audio-only.
 *
 * **Promotion is one-way.** A promoted room stays promoted until it empties.
 * A room oscillating around the threshold would otherwise renegotiate on every
 * join and leave, and each transition is an audible glitch. It also deletes the
 * harder half of the migration state machine — there is no demotion path to
 * write, only `release` when the last participant goes.
 */
@Injectable()
export class VoiceTopologyService {
  /** Channels that have been promoted at least once since going empty. */
  private readonly promoted = new Set<string>();
  private readonly config: VoiceConfig;

  constructor(configService: ConfigService) {
    this.config = configService.get<VoiceConfig>('voice') as VoiceConfig;
  }

  get meshMax(): number {
    return this.config.meshMax;
  }

  /** Whether a Cloudflare Realtime app is configured to promote rooms onto. */
  get sfuEnabled(): boolean {
    return Boolean(this.config.sfu.appId && this.config.sfu.appSecret);
  }

  /**
   * How many people a room can hold. Without the SFU a room past the mesh
   * limit has nowhere to put the extra streams, so the mesh limit is the cap.
   */
  get capacity(): number {
    return this.sfuEnabled
      ? Math.max(this.config.sfuMax, this.config.meshMax)
      : this.config.meshMax;
  }

  /** The room's topology as it stands, without deciding anything. */
  current(channelId: string): VoiceTopology {
    return this.promoted.has(channelId) ? 'sfu' : 'mesh';
  }

  /**
   * Whether a room with `participantCount` people — or with anyone publishing
   * video — needs the SFU. Pure: deciding and promoting are separate so a
   * caller can refuse a join without leaving the room marked promoted.
   */
  needsSfu(participantCount: number, video = false): boolean {
    return video || participantCount > this.config.meshMax;
  }

  /**
   * Moves a room onto the SFU. Returns `true` only on the transition, so the
   * caller announces `voice:topology-changed` exactly once.
   */
  promote(channelId: string): boolean {
    if (this.promoted.has(channelId)) return false;

    this.promoted.add(channelId);
    return true;
  }

  /** Called when a room empties: the next occupant starts back on the mesh. */
  release(channelId: string): void {
    this.promoted.delete(channelId);
  }

  /**
   * The audio ceiling a client should apply with `RTCRtpSender.setParameters()`.
   *
   * In a mesh a sender encodes and uploads once *per peer*, so the per-stream
   * ceiling has to divide the uplink budget by the number of peers being sent
   * to. On the SFU a sender uploads once whatever the room size, so the
   * nominal Opus bitrate always stands.
   *
   * This is a ceiling only. We do not implement adaptive bitrate — WebRTC's own
   * congestion control (GCC/TWCC) already adapts continuously.
   */
  bitrateFor(
    participantCount: number,
    topology: VoiceTopology,
  ): VoiceBitratePolicy {
    const { maxAudioBitrate, uplinkBudget } = this.config;

    const peers = participantCount - 1;
    if (topology === 'sfu' || peers < 1) {
      return { audio: { maxBitrate: maxAudioBitrate } };
    }

    return {
      audio: {
        maxBitrate: Math.min(maxAudioBitrate, Math.floor(uplinkBudget / peers)),
      },
    };
  }

  /** The video policy for the join ack; `null` means this server has no video. */
  videoPolicy(): VoiceVideoPolicy | null {
    return this.sfuEnabled ? VIDEO_POLICY : null;
  }
}
