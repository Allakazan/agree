import { Injectable } from '@nestjs/common';
import {
  VoiceParticipantState,
  VoicePresenceStore,
  VoiceRemoval,
  VoiceSfuState,
} from './voice.presence.interface';
import { VoiceParticipant, VoiceTrack } from './types/voice.types';

/**
 * In-memory `VoicePresenceStore`. Correct for exactly one instance — which is
 * also all the socket.io rooms it mirrors can serve without a Redis adapter, so
 * nothing is lost by keeping both single-process until they move together.
 *
 * Three indexes, kept in step by every mutating method:
 *  - `byChannel`: channelId → socketId → participant, for the roster.
 *  - `bySocket`: socketId → channels, so a disconnect costs O(channels of that
 *    socket) instead of a scan of every channel on the server.
 *  - `sfu`: channelId → socketId → SFU state, beside the participant rather
 *    than on it, so a broadcast participant can never carry a session id.
 * `Map` preserves insertion order, so the roster comes out in join order.
 */
@Injectable()
export class InMemoryVoicePresenceService implements VoicePresenceStore {
  private readonly byChannel = new Map<string, Map<string, VoiceParticipant>>();
  private readonly bySocket = new Map<string, Set<string>>();
  private readonly sfu = new Map<string, Map<string, VoiceSfuState>>();

  add(
    channelId: string,
    participant: VoiceParticipant,
  ): Promise<VoiceParticipant> {
    let channel = this.byChannel.get(channelId);
    if (!channel) {
      channel = new Map<string, VoiceParticipant>();
      this.byChannel.set(channelId, channel);
    }
    channel.set(participant.socketId, participant);

    let channels = this.bySocket.get(participant.socketId);
    if (!channels) {
      channels = new Set<string>();
      this.bySocket.set(participant.socketId, channels);
    }
    channels.add(channelId);

    return Promise.resolve(participant);
  }

  remove(
    channelId: string,
    socketId: string,
  ): Promise<VoiceParticipant | null> {
    return Promise.resolve(
      this.removeSync(channelId, socketId)?.participant ?? null,
    );
  }

  removeSocket(socketId: string): Promise<VoiceRemoval[]> {
    const channels = this.bySocket.get(socketId);
    if (!channels) return Promise.resolve([]);

    // Copy first: removeSync mutates the very set being iterated.
    const removals = [...channels]
      .map((channelId) => this.removeSync(channelId, socketId))
      .filter((removal): removal is VoiceRemoval => removal !== null);

    return Promise.resolve(removals);
  }

  get(channelId: string, socketId: string): Promise<VoiceParticipant | null> {
    return Promise.resolve(
      this.byChannel.get(channelId)?.get(socketId) ?? null,
    );
  }

  listByChannel(channelId: string): Promise<VoiceParticipant[]> {
    return Promise.resolve([
      ...(this.byChannel.get(channelId)?.values() ?? []),
    ]);
  }

  countByChannel(channelId: string): Promise<number> {
    return Promise.resolve(this.byChannel.get(channelId)?.size ?? 0);
  }

  setState(
    channelId: string,
    socketId: string,
    state: VoiceParticipantState,
  ): Promise<VoiceParticipant | null> {
    return Promise.resolve(
      this.replace(channelId, socketId, (current) => ({
        ...current,
        ...state,
      })),
    );
  }

  findByUser(
    channelId: string,
    userId: string,
  ): Promise<VoiceParticipant | null> {
    for (const participant of this.byChannel.get(channelId)?.values() ?? []) {
      if (participant.userId === userId) return Promise.resolve(participant);
    }
    return Promise.resolve(null);
  }

  addTracks(
    channelId: string,
    socketId: string,
    tracks: VoiceTrack[],
  ): Promise<VoiceParticipant | null> {
    return Promise.resolve(
      this.replace(channelId, socketId, (current) => ({
        ...current,
        tracks: [...current.tracks, ...tracks],
      })),
    );
  }

  removeTracks(
    channelId: string,
    socketId: string,
    trackNames: string[],
  ): Promise<VoiceParticipant | null> {
    return Promise.resolve(
      this.replace(channelId, socketId, (current) => ({
        ...current,
        tracks: current.tracks.filter(
          (track) => !trackNames.includes(track.trackName),
        ),
      })),
    );
  }

  getSfuState(
    channelId: string,
    socketId: string,
  ): Promise<VoiceSfuState | null> {
    return Promise.resolve(this.sfu.get(channelId)?.get(socketId) ?? null);
  }

  setSfuState(
    channelId: string,
    socketId: string,
    state: VoiceSfuState,
  ): Promise<void> {
    if (!this.byChannel.get(channelId)?.has(socketId)) return Promise.resolve();

    let channel = this.sfu.get(channelId);
    if (!channel) {
      channel = new Map<string, VoiceSfuState>();
      this.sfu.set(channelId, channel);
    }
    channel.set(socketId, state);

    return Promise.resolve();
  }

  /**
   * Swaps a participant for an updated copy rather than mutating it in place,
   * so a roster snapshot handed out earlier keeps the values it was read with.
   */
  private replace(
    channelId: string,
    socketId: string,
    update: (current: VoiceParticipant) => VoiceParticipant,
  ): VoiceParticipant | null {
    const channel = this.byChannel.get(channelId);
    const current = channel?.get(socketId);
    if (!channel || !current) return null;

    const updated = update(current);
    channel.set(socketId, updated);

    return updated;
  }

  /**
   * The one place every index is unwound. Deletes the channel, socket and SFU
   * buckets once they empty, so an idle server holds no keys for channels
   * nobody is in.
   */
  private removeSync(channelId: string, socketId: string): VoiceRemoval | null {
    const channel = this.byChannel.get(channelId);
    const participant = channel?.get(socketId);
    if (!channel || !participant) return null;

    channel.delete(socketId);
    const channelEmptied = channel.size === 0;
    if (channelEmptied) this.byChannel.delete(channelId);

    const channels = this.bySocket.get(socketId);
    channels?.delete(channelId);
    if (channels && channels.size === 0) this.bySocket.delete(socketId);

    const sfu = this.sfu.get(channelId);
    sfu?.delete(socketId);
    if (sfu && sfu.size === 0) this.sfu.delete(channelId);

    return { channelId, participant, channelEmptied };
  }
}
