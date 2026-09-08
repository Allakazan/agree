import { InMemoryVoicePresenceService } from './voice.presence.service';
import { VoiceParticipant } from './types/voice.types';

describe('InMemoryVoicePresenceService', () => {
  let presence: InMemoryVoicePresenceService;

  const participant = (socketId: string, userId: string): VoiceParticipant => ({
    socketId,
    userId,
    username: userId,
    muted: false,
    deafened: false,
    joinedAt: '2025-09-07T12:00:00.000Z',
  });

  beforeEach(() => {
    presence = new InMemoryVoicePresenceService();
  });

  it('lists a channel in join order', async () => {
    await presence.add('channel-a', participant('socket-1', 'user-1'));
    await presence.add('channel-a', participant('socket-2', 'user-2'));

    expect(
      (await presence.listByChannel('channel-a')).map((p) => p.socketId),
    ).toEqual(['socket-1', 'socket-2']);
    expect(await presence.countByChannel('channel-a')).toBe(2);
  });

  it('reports an empty channel as empty', async () => {
    expect(await presence.listByChannel('nobody-here')).toEqual([]);
    expect(await presence.countByChannel('nobody-here')).toBe(0);
  });

  it('returns the removed participant, and null when it was not there', async () => {
    await presence.add('channel-a', participant('socket-1', 'user-1'));

    expect(await presence.remove('channel-a', 'socket-1')).toMatchObject({
      socketId: 'socket-1',
    });
    // Idempotent: a leave racing a disconnect must not broadcast twice.
    expect(await presence.remove('channel-a', 'socket-1')).toBeNull();
    expect(await presence.countByChannel('channel-a')).toBe(0);
  });

  describe('removeSocket', () => {
    it('clears the socket from every channel it was in', async () => {
      await presence.add('channel-a', participant('socket-1', 'user-1'));
      await presence.add('channel-b', participant('socket-1', 'user-1'));

      const removals = await presence.removeSocket('socket-1');

      expect(removals.map((r) => r.channelId).sort()).toEqual([
        'channel-a',
        'channel-b',
      ]);
      expect(await presence.countByChannel('channel-a')).toBe(0);
      expect(await presence.countByChannel('channel-b')).toBe(0);
    });

    it('flags whether each channel was emptied by the removal', async () => {
      await presence.add('channel-a', participant('socket-1', 'user-1'));
      await presence.add('channel-a', participant('socket-2', 'user-2'));
      await presence.add('channel-b', participant('socket-1', 'user-1'));

      const removals = await presence.removeSocket('socket-1');

      expect(
        removals.find((r) => r.channelId === 'channel-a')?.channelEmptied,
      ).toBe(false);
      expect(
        removals.find((r) => r.channelId === 'channel-b')?.channelEmptied,
      ).toBe(true);
    });

    it('returns nothing for a socket that never joined a voice channel', async () => {
      expect(await presence.removeSocket('socket-unknown')).toEqual([]);
    });
  });

  describe('setState', () => {
    it('persists mute and deafen so a late joiner sees them', async () => {
      await presence.add('channel-a', participant('socket-1', 'user-1'));

      const updated = await presence.setState('channel-a', 'socket-1', {
        muted: true,
        deafened: false,
      });

      expect(updated).toMatchObject({ muted: true, deafened: false });
      expect((await presence.listByChannel('channel-a'))[0].muted).toBe(true);
    });

    it('does not mutate a roster snapshot handed out earlier', async () => {
      await presence.add('channel-a', participant('socket-1', 'user-1'));
      const before = await presence.listByChannel('channel-a');

      await presence.setState('channel-a', 'socket-1', {
        muted: true,
        deafened: true,
      });

      expect(before[0].muted).toBe(false);
    });

    it('returns null for a socket that is not in the channel', async () => {
      expect(
        await presence.setState('channel-a', 'socket-1', {
          muted: true,
          deafened: false,
        }),
      ).toBeNull();
    });
  });

  describe('findByUser', () => {
    it('finds the user regardless of which socket they are on', async () => {
      await presence.add('channel-a', participant('socket-9', 'user-1'));

      expect(await presence.findByUser('channel-a', 'user-1')).toMatchObject({
        socketId: 'socket-9',
      });
    });

    it('is scoped to the channel', async () => {
      await presence.add('channel-a', participant('socket-1', 'user-1'));

      expect(await presence.findByUser('channel-b', 'user-1')).toBeNull();
    });
  });
});
