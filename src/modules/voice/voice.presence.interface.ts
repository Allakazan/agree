import { VoiceParticipant } from './types/voice.types';

/** DI token — `VoicePresenceStore` is an interface and erases at runtime. */
export const VOICE_PRESENCE_STORE = 'VOICE_PRESENCE_STORE';

/** The mutable half of a participant: what `voice:state` is allowed to change. */
export type VoiceParticipantState = Pick<
  VoiceParticipant,
  'muted' | 'deafened'
>;

/** What `removeSocket` found and cleared, per channel the socket was in. */
export type VoiceRemoval = {
  channelId: string;
  participant: VoiceParticipant;
  /** True when that was the channel's last participant — the room is now empty. */
  channelEmptied: boolean;
};

/**
 * Where "who is in which voice channel" lives.
 *
 * Every method is async even though the only implementation today is a
 * synchronous `Map`: this interface is the Redis seam. Presence must move to
 * Redis before a second instance can run (rooms are per-process too, which is
 * what `@socket.io/redis-adapter` solves), and a synchronous signature here
 * would force every caller to change at that point.
 */
export interface VoicePresenceStore {
  /**
   * Records a socket in a channel. Returns the stored participant. Callers must
   * have authorized the join first — the store is bookkeeping, not a gate.
   */
  add(
    channelId: string,
    participant: VoiceParticipant,
  ): Promise<VoiceParticipant>;

  /**
   * Drops one socket from one channel. Returns the participant that was there,
   * or `null` if it wasn't — so callers can broadcast exactly once and stay
   * idempotent when a leave races a disconnect.
   */
  remove(channelId: string, socketId: string): Promise<VoiceParticipant | null>;

  /** Drops a socket from every channel it was in. The disconnect sweep. */
  removeSocket(socketId: string): Promise<VoiceRemoval[]>;

  /** The channel's roster, in join order. */
  listByChannel(channelId: string): Promise<VoiceParticipant[]>;

  countByChannel(channelId: string): Promise<number>;

  /**
   * Persists mute/deafen so a late joiner renders the right icons. Returns the
   * updated participant, or `null` if the socket isn't in that channel.
   */
  setState(
    channelId: string,
    socketId: string,
    state: VoiceParticipantState,
  ): Promise<VoiceParticipant | null>;

  /**
   * The user's socket in a channel, if any. Serves two callers at once: the
   * signal relay (a target that isn't here cannot be signalled) and the
   * one-socket-per-user rule on join.
   */
  findByUser(
    channelId: string,
    userId: string,
  ): Promise<VoiceParticipant | null>;
}
