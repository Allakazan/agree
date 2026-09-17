/**
 * Where a published track comes from. One track per source per participant:
 * the source doubles as the track's name on the SFU, which is how a second
 * camera from the same socket is refused and how a puller addresses a track
 * without ever learning a Cloudflare session id.
 */
export const VOICE_TRACK_SOURCES = [
  'mic',
  'camera',
  'screen',
  'screen-audio',
] as const;
export type VoiceTrackSource = (typeof VOICE_TRACK_SOURCES)[number];

export type VoiceTrackKind = 'audio' | 'video';

/**
 * `MediaStreamTrack.contentHint` for a screenshare. Text and motion want
 * opposite tradeoffs — resolution vs frame rate — so each gets its own
 * simulcast ladder. A camera is always `motion` and never carries one.
 */
export const VOICE_CONTENT_HINTS = ['detail', 'motion'] as const;
export type VoiceContentHint = (typeof VOICE_CONTENT_HINTS)[number];

/**
 * Simulcast layer ids, best first. Cloudflare does not mandate these names;
 * they are chosen so that its `asciibetical` ordering — where `a` is the most
 * desirable — coincides with decreasing quality.
 */
export const SIMULCAST_RIDS = ['f', 'h', 'q'] as const;
export type SimulcastRid = (typeof SIMULCAST_RIDS)[number];

/** A track a participant is publishing to the SFU. Safe to broadcast. */
export type VoiceTrack = {
  /** The track's name on the SFU. Always equal to `source`. */
  trackName: VoiceTrackSource;
  source: VoiceTrackSource;
  kind: VoiceTrackKind;
  /** Screenshares only: which ladder the publisher encodes. */
  contentHint?: VoiceContentHint;
  /** The simulcast layers on offer, best first. Empty for audio. */
  rids: SimulcastRid[];
};

/**
 * One connected voice member. Keyed by `socketId` rather than `userId`: a user
 * with two tabs open has two sockets, and only the *last* one leaving means the
 * user left. `username` is denormalized from the JWT so the roster needs no
 * Mongo round trip.
 *
 * This is the broadcast shape. The participant's Cloudflare session lives
 * beside it in the presence store (`VoiceSfuState`), never on it, so no emit
 * can leak it.
 */
export type VoiceParticipant = {
  socketId: string;
  userId: string;
  username: string;
  muted: boolean;
  deafened: boolean;
  /** ISO8601. Lets a client order the roster by arrival without a server sort. */
  joinedAt: string;
  /** What this participant publishes to the SFU. Always empty on the mesh. */
  tracks: VoiceTrack[];
};

/** Where the media flows. One per room, never per media kind. */
export type VoiceTopology = 'mesh' | 'sfu';

/**
 * A client-side ceiling, not a server-enforced one: `maxBitrate` is applied by
 * `RTCRtpSender.setParameters()` in the browser. The server ships a policy and
 * trusts the client — SDP munging (`b=AS:`) is fragile and not worth it.
 */
export type VoiceBitratePolicy = {
  audio: { maxBitrate: number };
};

/** One simulcast layer, shaped to drop straight into `sendEncodings`. */
export type SimulcastEncoding = {
  rid: SimulcastRid;
  maxBitrate: number;
  maxFramerate: number;
  scaleResolutionDownBy: number;
};

/** Capture constraints plus the layers to encode from that capture. */
export type SimulcastProfile = {
  capture: { width: number; height: number; frameRate: number };
  /** Best first. */
  encodings: SimulcastEncoding[];
};

export type VideoProfileName = 'camera' | 'screenDetail' | 'screenMotion';

/**
 * What a client needs to publish video the way the server will accept it: the
 * codecs to restrict its offer to (`setCodecPreferences`) and the ladder for
 * each kind of video source.
 */
export type VoiceVideoPolicy = {
  codecs: string[];
  profiles: Record<VideoProfileName, SimulcastProfile>;
};

/** Shape of one entry in an `RTCPeerConnection`'s `iceServers` config. */
export type IceServer = {
  urls: string | string[];
  username?: string;
  credential?: string;
};

/**
 * The `voice:join` acknowledgement — everything a client needs to build its
 * peer connections, in one round trip.
 */
export type VoiceJoinAck = {
  channelId: string;
  /** The joiner's own user id: what peers address it by in `voice:signal`. */
  selfId: string;
  socketId: string;
  topology: VoiceTopology;
  /** Everyone already in the room, excluding the joiner — the peers to offer to. */
  participants: VoiceParticipant[];
  iceServers: IceServer[];
  bitrate: VoiceBitratePolicy;
  /** `null` when the SFU is not configured: this server carries no video. */
  video: VoiceVideoPolicy | null;
};
