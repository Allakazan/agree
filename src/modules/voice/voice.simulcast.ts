import {
  SimulcastProfile,
  SimulcastRid,
  VideoProfileName,
  VoiceContentHint,
  VoiceTrackKind,
  VoiceTrackSource,
  VoiceVideoPolicy,
} from './types/voice.types';

/**
 * Codecs a publish offer may carry, per kind. The allowlist is ours, not a
 * Cloudflare limitation (it takes H264/H265/VP8/VP9/AV1 and Opus/G.711).
 *
 * VP8 because it is the codec whose simulcast works reliably in every browser;
 * VP9 and AV1 lean on SVC (`scalabilityMode`) rather than simulcast and are
 * expensive to encode. An offer carrying *only* allowed codecs leaves
 * Cloudflare's answer no other choice, so this is enforcement, not a hint.
 * Compared case-insensitively against `a=rtpmap` encoding names.
 */
export const ALLOWED_CODECS: Record<VoiceTrackKind, string[]> = {
  audio: ['opus'],
  video: ['VP8'],
};

/**
 * The simulcast ladders, as a published policy — like the audio bitrate, the
 * server ships these and the client applies them via `sendEncodings`. The
 * layers themselves are checked on publish (`a=simulcast:send` must declare
 * exactly these rids); the bitrates cannot be, since they never reach the SDP.
 *
 * A table of policy rather than env knobs: the values only make sense
 * together, and tuning one without the others produces a worse ladder.
 */
export const SIMULCAST_PROFILES: Record<VideoProfileName, SimulcastProfile> = {
  camera: {
    capture: { width: 1280, height: 720, frameRate: 30 },
    encodings: [
      {
        rid: 'f',
        maxBitrate: 1_200_000,
        maxFramerate: 30,
        scaleResolutionDownBy: 1,
      },
      {
        rid: 'h',
        maxBitrate: 500_000,
        maxFramerate: 30,
        scaleResolutionDownBy: 2,
      },
      {
        rid: 'q',
        maxBitrate: 150_000,
        maxFramerate: 15,
        scaleResolutionDownBy: 4,
      },
    ],
  },
  // Two layers on purpose: a 360p share of code is unreadable, so a third
  // layer would be pure wasted egress.
  screenDetail: {
    capture: { width: 1920, height: 1080, frameRate: 15 },
    encodings: [
      {
        rid: 'f',
        maxBitrate: 2_000_000,
        maxFramerate: 15,
        scaleResolutionDownBy: 1,
      },
      {
        rid: 'h',
        maxBitrate: 800_000,
        maxFramerate: 15,
        scaleResolutionDownBy: 1.5,
      },
    ],
  },
  screenMotion: {
    capture: { width: 1920, height: 1080, frameRate: 30 },
    encodings: [
      {
        rid: 'f',
        maxBitrate: 3_000_000,
        maxFramerate: 30,
        scaleResolutionDownBy: 1,
      },
      {
        rid: 'h',
        maxBitrate: 1_200_000,
        maxFramerate: 30,
        scaleResolutionDownBy: 1.5,
      },
      {
        rid: 'q',
        maxBitrate: 500_000,
        maxFramerate: 30,
        scaleResolutionDownBy: 2,
      },
    ],
  },
};

export const VIDEO_POLICY: VoiceVideoPolicy = {
  codecs: ALLOWED_CODECS.video,
  profiles: SIMULCAST_PROFILES,
};

export const sourceKind = (source: VoiceTrackSource): VoiceTrackKind =>
  source === 'camera' || source === 'screen' ? 'video' : 'audio';

/** The ladder a video source encodes; `null` for audio, which has none. */
export const profileFor = (
  source: VoiceTrackSource,
  contentHint?: VoiceContentHint,
): VideoProfileName | null => {
  if (source === 'camera') return 'camera';
  if (source === 'screen') {
    return contentHint === 'motion' ? 'screenMotion' : 'screenDetail';
  }
  return null;
};

/** The simulcast layers a source publishes, best first. Empty for audio. */
export const ridsFor = (
  source: VoiceTrackSource,
  contentHint?: VoiceContentHint,
): SimulcastRid[] => {
  const profile = profileFor(source, contentHint);
  return profile
    ? SIMULCAST_PROFILES[profile].encodings.map(({ rid }) => rid)
    : [];
};
