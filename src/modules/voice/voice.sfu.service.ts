import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { VoiceSfuPublishTrackDto } from './dto/voice-sfu-publish.dto';
import { VoiceSfuPullTrackDto } from './dto/voice-sfu-pull.dto';
import {
  CloudflareSfuClient,
  SessionDescription,
  SfuSimulcast,
} from './voice.sfu.client';
import {
  findMediaSection,
  primaryCodecs,
  simulcastSendRids,
} from './voice.sdp';
import { ALLOWED_CODECS, ridsFor, sourceKind } from './voice.simulcast';
import {
  VOICE_PRESENCE_STORE,
  VoicePresenceStore,
  VoicePulledTrack,
  VoiceSfuState,
} from './voice.presence.interface';
import {
  SimulcastRid,
  VoiceParticipant,
  VoiceTrack,
} from './types/voice.types';

/**
 * A published track, beside the mid it went out under. The mid only means
 * something on the publisher's own connection, so it stays out of the
 * `VoiceTrack` that is broadcast to the room.
 */
export type VoicePublishedTrack = { mid: string; track: VoiceTrack };

export type VoiceSfuPublishResult = {
  sessionDescription: SessionDescription;
  tracks: VoicePublishedTrack[];
};

export type VoiceSfuPullResult = {
  /** Cloudflare's offer, to answer via `voice:sfu:renegotiate`. */
  sessionDescription?: SessionDescription;
  requiresImmediateRenegotiation: boolean;
  tracks: { mid: string; userId: string; trackName: string }[];
};

export type VoiceSfuCloseResult = {
  /** Names of this socket's own tracks the close took off the room. */
  unpublished: string[];
};

/**
 * Pulls on video ask Cloudflare to walk down the ladder on congestion, and to
 * fall back to the next layer when the one asked for disappears (a publisher
 * whose encoder drops its top layer under CPU pressure, say). `f/h/q` sort
 * best-first under `asciibetical`, which is why the rids are named that way.
 */
const simulcastFor = (preferredRid: SimulcastRid): SfuSimulcast => ({
  preferredRid,
  priorityOrdering: 'asciibetical',
  ridNotAvailable: 'asciibetical',
});

/**
 * Everything the voice gateway does against the Cloudflare SFU, with the
 * authorization and bookkeeping that make proxying it safe.
 *
 * The gateway has already asserted the socket is in the room; what this adds:
 *  - **Pulls resolve through presence.** A client names a publisher by user id
 *    and a track by name; the publisher's Cloudflare session comes from the
 *    presence store, never from the client. Someone not in the room has no
 *    session there to pull from.
 *  - **Publishes are inspected** (`voice.sdp.ts`): codecs, simulcast layers and
 *    media kind per mid, before anything reaches Cloudflare.
 *  - **Egress is policed here**, since it is the only part of the bill the
 *    server can actually control: one pull per publisher track, and only on a
 *    layer the publisher offers.
 *
 * Calls for one socket are serialized. Every operation is a read-modify-write
 * of that socket's SFU state around an HTTP call, and two in flight at once —
 * a publish and a pull fired together — would each write back a state missing
 * the other's mids. Like presence itself, the queue is per-process.
 */
@Injectable()
export class VoiceSfuService {
  private readonly logger = new Logger(VoiceSfuService.name);
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(
    private readonly client: CloudflareSfuClient,
    @Inject(VOICE_PRESENCE_STORE)
    private readonly presence: VoicePresenceStore,
  ) {}

  publish(
    channelId: string,
    socketId: string,
    offer: SessionDescription,
    requested: VoiceSfuPublishTrackDto[],
  ): Promise<VoiceSfuPublishResult> {
    return this.serialize(socketId, async () => {
      const self = await this.requireParticipant(channelId, socketId);
      const state = await this.presence.getSfuState(channelId, socketId);
      const tracks = this.describePublish(offer.sdp, requested, self, state);

      const { sessionId, sessionDescription } = await this.sfu(
        'publish',
        socketId,
        async () => {
          const sessionId =
            state?.sessionId ?? (await this.client.createSession());
          const response = await this.client.pushTracks(
            sessionId,
            offer,
            tracks.map(({ mid, track }) => ({
              mid,
              trackName: track.trackName,
            })),
          );

          if (!response.sessionDescription) {
            throw new Error('no answer in the push response');
          }

          return { sessionId, sessionDescription: response.sessionDescription };
        },
      );

      await this.presence.setSfuState(channelId, socketId, {
        sessionId,
        published: {
          ...state?.published,
          ...Object.fromEntries(
            tracks.map(({ mid, track }) => [mid, track.trackName]),
          ),
        },
        pulled: state?.pulled ?? {},
      });
      await this.presence.addTracks(
        channelId,
        socketId,
        tracks.map(({ track }) => track),
      );

      return { sessionDescription, tracks };
    });
  }

  pull(
    channelId: string,
    socketId: string,
    requested: VoiceSfuPullTrackDto[],
  ): Promise<VoiceSfuPullResult> {
    return this.serialize(socketId, async () => {
      const self = await this.requireParticipant(channelId, socketId);
      const state = await this.presence.getSfuState(channelId, socketId);

      const alreadyPulled = new Set(
        Object.values(state?.pulled ?? {}).map((pull) =>
          pullKey(pull.publisherSocketId, pull.trackName),
        ),
      );

      const remotes: {
        publisher: VoiceParticipant;
        sessionId: string;
        trackName: string;
        simulcast?: SfuSimulcast;
      }[] = [];

      for (const request of requested) {
        if (request.userId === self.userId) {
          throw new BadRequestException('Cannot pull your own track');
        }

        const publisher = await this.presence.findByUser(
          channelId,
          request.userId,
        );
        if (!publisher) {
          throw new BadRequestException(
            'That peer is not in this voice channel',
          );
        }

        const track = this.requirePublishedTrack(publisher, request.trackName);
        const publisherState = await this.presence.getSfuState(
          channelId,
          publisher.socketId,
        );
        if (!publisherState) {
          throw new BadRequestException(
            `That peer is not publishing ${request.trackName}`,
          );
        }

        const key = pullKey(publisher.socketId, track.trackName);
        if (alreadyPulled.has(key)) {
          throw new BadRequestException(
            `You are already receiving ${track.trackName} from that peer`,
          );
        }
        alreadyPulled.add(key);

        remotes.push({
          publisher,
          sessionId: publisherState.sessionId,
          trackName: track.trackName,
          simulcast: this.pullSimulcast(track, request.preferredRid),
        });
      }

      const { sessionId, response } = await this.sfu(
        'pull',
        socketId,
        async () => {
          const sessionId =
            state?.sessionId ?? (await this.client.createSession());
          const response = await this.client.pullTracks(
            sessionId,
            remotes.map(({ sessionId, trackName, simulcast }) => ({
              sessionId,
              trackName,
              ...(simulcast ? { simulcast } : {}),
            })),
          );
          return { sessionId, response };
        },
      );

      const pulled = remotes.map((remote, index) => {
        // Matched by publisher session + name rather than by position, which
        // the API does not promise to preserve.
        const echoed =
          response.tracks?.find(
            (track) =>
              track.sessionId === remote.sessionId &&
              track.trackName === remote.trackName,
          ) ?? response.tracks?.[index];

        if (!echoed?.mid) {
          this.logger.error(
            `pull for socket ${socketId}: no mid for ${remote.trackName}`,
          );
          throw new BadRequestException(
            'The media server rejected the request',
          );
        }

        return { mid: echoed.mid, remote };
      });

      await this.presence.setSfuState(channelId, socketId, {
        sessionId,
        published: state?.published ?? {},
        pulled: {
          ...state?.pulled,
          ...Object.fromEntries(
            pulled.map(({ mid, remote }): [string, VoicePulledTrack] => [
              mid,
              {
                publisherSocketId: remote.publisher.socketId,
                publisherUserId: remote.publisher.userId,
                trackName: remote.trackName,
              },
            ]),
          ),
        },
      });

      return {
        sessionDescription: response.sessionDescription,
        requiresImmediateRenegotiation:
          response.requiresImmediateRenegotiation ?? false,
        tracks: pulled.map(({ mid, remote }) => ({
          mid,
          userId: remote.publisher.userId,
          trackName: remote.trackName,
        })),
      };
    });
  }

  renegotiate(
    channelId: string,
    socketId: string,
    answer: SessionDescription,
  ): Promise<void> {
    return this.serialize(socketId, async () => {
      const state = await this.requireSfuState(channelId, socketId);

      await this.sfu('renegotiate', socketId, () =>
        this.client.renegotiate(state.sessionId, answer),
      );
    });
  }

  close(
    channelId: string,
    socketId: string,
    requestedMids: string[],
  ): Promise<VoiceSfuCloseResult> {
    return this.serialize(socketId, async () => {
      const state = await this.requireSfuState(channelId, socketId);
      const mids = [...new Set(requestedMids)];

      for (const mid of mids) {
        if (!(mid in state.published) && !(mid in state.pulled)) {
          throw new BadRequestException(`Unknown track mid ${mid}`);
        }
      }

      this.logger.debug(
        `SFU close mids: ${mids
          .map((mid) =>
            mid in state.published
              ? `${mid}=published:${state.published[mid]}`
              : `${mid}=pulled:${state.pulled[mid].trackName}`,
          )
          .join(', ')}`,
      );

      await this.sfu('close', socketId, () =>
        this.client.closeTracks(state.sessionId, mids),
      );

      const unpublished = mids
        .filter((mid) => mid in state.published)
        .map((mid) => state.published[mid]);

      await this.presence.setSfuState(channelId, socketId, {
        sessionId: state.sessionId,
        published: withoutKeys(state.published, mids),
        pulled: withoutKeys(state.pulled, mids),
      });
      if (unpublished.length) {
        await this.presence.removeTracks(channelId, socketId, unpublished);
      }

      return { unpublished };
    });
  }

  setLayer(
    channelId: string,
    socketId: string,
    mid: string,
    preferredRid: SimulcastRid,
  ): Promise<void> {
    return this.serialize(socketId, async () => {
      const state = await this.requireSfuState(channelId, socketId);

      const pull = state.pulled[mid];
      if (!pull) throw new BadRequestException(`Unknown track mid ${mid}`);

      const publisher = await this.presence.get(
        channelId,
        pull.publisherSocketId,
      );
      const publisherState =
        publisher &&
        (await this.presence.getSfuState(channelId, publisher.socketId));
      if (!publisher || !publisherState) {
        throw new BadRequestException(
          'That peer is no longer in this voice channel',
        );
      }

      const track = this.requirePublishedTrack(publisher, pull.trackName);
      if (track.kind !== 'video') {
        throw new BadRequestException('Audio tracks have no layers');
      }

      const simulcast = this.pullSimulcast(track, preferredRid);

      await this.sfu('layer', socketId, () =>
        this.client.updateTracks(state.sessionId, [
          {
            location: 'remote',
            mid,
            sessionId: publisherState.sessionId,
            trackName: track.trackName,
            simulcast,
          },
        ]),
      );
    });
  }

  /**
   * Validates a publish against the offer it rides in, and describes the
   * tracks it will create. Throws before anything reaches Cloudflare.
   */
  private describePublish(
    sdp: string,
    requested: VoiceSfuPublishTrackDto[],
    self: VoiceParticipant,
    state: VoiceSfuState | null,
  ): VoicePublishedTrack[] {
    const sources = new Set<string>();
    const mids = new Set<string>();

    return requested.map(({ mid, source, contentHint }) => {
      if (sources.has(source) || self.tracks.some((t) => t.source === source)) {
        throw new BadRequestException(
          `You are already publishing a ${source} track`,
        );
      }
      sources.add(source);

      if (mids.has(mid) || state?.published[mid] || state?.pulled[mid]) {
        throw new BadRequestException(`Track mid ${mid} is already in use`);
      }
      mids.add(mid);

      const kind = sourceKind(source);
      const section = findMediaSection(sdp, mid);

      if (!section) {
        throw new BadRequestException(
          `The offer has no media section for mid ${mid}`,
        );
      }

      if (section.kind !== kind) {
        throw new BadRequestException(
          `A ${source} track must be ${kind}, but mid ${mid} is ${section.kind}`,
        );
      }

      // Only allowed codecs, not merely an allowed one first: an offer that
      // carries nothing else leaves Cloudflare's answer no other choice.
      const allowed = ALLOWED_CODECS[kind];
      const offered = primaryCodecs(section);
      const lowered = allowed.map((codec) => codec.toLowerCase());
      if (!offered.length || offered.some((c) => !lowered.includes(c))) {
        throw new BadRequestException(
          `A ${source} track must offer only ${allowed.join(', ')} (got ${
            offered.join(', ') || 'none'
          })`,
        );
      }

      const hint = source === 'screen' ? contentHint : undefined;
      const rids = ridsFor(source, hint);

      if (kind === 'video') {
        const layers = simulcastSendRids(section);
        if (!sameMembers(layers, rids)) {
          throw new BadRequestException(
            `A ${source} track must simulcast exactly ${rids.join(';')} (got ${
              layers.join(';') || 'none'
            })`,
          );
        }
      }

      return {
        mid,
        track: {
          trackName: source,
          source,
          kind,
          ...(hint ? { contentHint: hint } : {}),
          rids,
        },
      };
    });
  }

  /**
   * The simulcast block for pulling `track`. Defaults to the cheapest layer:
   * this is where the egress bill lives, and a client that wants more asks for
   * it by tile size.
   */
  private pullSimulcast(
    track: VoiceTrack,
    preferredRid?: SimulcastRid,
  ): SfuSimulcast | undefined {
    if (track.kind === 'audio') {
      if (preferredRid) {
        throw new BadRequestException('Audio tracks have no layers');
      }
      return undefined;
    }

    const rid = preferredRid ?? track.rids[track.rids.length - 1];
    if (!track.rids.includes(rid)) {
      throw new BadRequestException(
        `Layer ${rid} is not available on that track (${track.rids.join(', ')})`,
      );
    }

    return simulcastFor(rid);
  }

  private requirePublishedTrack(
    publisher: VoiceParticipant,
    trackName: string,
  ): VoiceTrack {
    const track = publisher.tracks.find((t) => t.trackName === trackName);
    if (!track) {
      throw new BadRequestException(`That peer is not publishing ${trackName}`);
    }
    return track;
  }

  private async requireParticipant(
    channelId: string,
    socketId: string,
  ): Promise<VoiceParticipant> {
    const participant = await this.presence.get(channelId, socketId);
    if (!participant) {
      throw new BadRequestException('You are not in this voice channel');
    }
    return participant;
  }

  private async requireSfuState(
    channelId: string,
    socketId: string,
  ): Promise<VoiceSfuState> {
    const state = await this.presence.getSfuState(channelId, socketId);
    if (!state) {
      throw new BadRequestException('You have no media session yet');
    }
    return state;
  }

  /**
   * Runs one Cloudflare exchange. Whatever goes wrong — a rejection, a
   * timeout, a malformed response — the client hears one generic message
   * (the exception filter only unwraps `BadRequestException`) and the detail
   * goes to the log, where it cannot tell a client anything about our app.
   */
  private async sfu<T>(
    operation: string,
    socketId: string,
    call: () => Promise<T>,
  ): Promise<T> {
    // Ties the client's `→`/`←` lines that follow to a socket.
    this.logger.debug(`SFU ${operation} for socket ${socketId}`);
    try {
      return await call();
    } catch (error) {
      this.logger.error(
        `SFU ${operation} failed for socket ${socketId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new BadRequestException('The media server rejected the request');
    }
  }

  /** Chains `task` behind whatever this socket already has in flight. */
  private serialize<T>(socketId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(socketId) ?? Promise.resolve();
    const run = previous.then(task, task);
    const settled = run.then(
      () => undefined,
      () => undefined,
    );

    this.queues.set(socketId, settled);
    void settled.then(() => {
      if (this.queues.get(socketId) === settled) this.queues.delete(socketId);
    });

    return run;
  }
}

const pullKey = (publisherSocketId: string, trackName: string): string =>
  `${publisherSocketId}:${trackName}`;

const sameMembers = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((value) => b.includes(value));

const withoutKeys = <T>(
  record: Record<string, T>,
  keys: string[],
): Record<string, T> =>
  Object.fromEntries(
    Object.entries(record).filter(([key]) => !keys.includes(key)),
  );
