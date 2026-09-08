/**
 * One connected voice member. Keyed by `socketId` rather than `userId`: a user
 * with two tabs open has two sockets, and only the *last* one leaving means the
 * user left. `username` is denormalized from the JWT so the roster needs no
 * Mongo round trip.
 */
export type VoiceParticipant = {
  socketId: string;
  userId: string;
  username: string;
  muted: boolean;
  deafened: boolean;
  /** ISO8601. Lets a client order the roster by arrival without a server sort. */
  joinedAt: string;
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
};
