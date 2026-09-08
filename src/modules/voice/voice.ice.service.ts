import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VoiceConfig } from 'src/config/voice';
import { IceServer } from './types/voice.types';

const CLOUDFLARE_TURN_API = 'https://rtc.live.cloudflare.com/v1/turn/keys';

/** How long before expiry a cached credential is refreshed. */
const REFRESH_MARGIN_SECONDS = 300;

/** How long a failed mint is remembered, so a join storm can't hammer the API. */
const FAILURE_BACKOFF_MS = 30_000;

const FETCH_TIMEOUT_MS = 5_000;

type CloudflareIceResponse = {
  iceServers?: IceServer | IceServer[];
};

/**
 * Supplies the `iceServers` array that goes into the client's
 * `RTCPeerConnection` config, in three tiers:
 *
 *  1. **A static TURN server** (`TURN_URL` / `TURN_USER` / `TURN_PASS`) — a
 *     coturn box or any hosted relay. Wins when set: it is the deliberate
 *     local-testing override.
 *  2. **Cloudflare Realtime TURN**, minting short-lived credentials.
 *  3. **STUN only.** Works for the ~80% of users not behind symmetric NAT, and
 *     is what a dev machine with no TURN configured gets.
 *
 * Only the third tier names a STUN server: a TURN server answers STUN too, and
 * the Allocate response carries the server-reflexive candidate alongside the
 * relay one, so pairing a `turn:` entry with a `stun:` entry gathers nothing
 * extra.
 *
 * Nothing here throws. A join must not fail because a relay provider is down —
 * degrading to STUN loses some users their connection, but refusing the join
 * loses everyone theirs.
 *
 * Credentials are per *key*, not per user, so the minted set is cached and
 * shared by every joiner until shortly before it expires.
 */
@Injectable()
export class VoiceIceService {
  private readonly logger = new Logger(VoiceIceService.name);
  private readonly config: VoiceConfig;

  private cached: { iceServers: IceServer[]; expiresAtMs: number } | null =
    null;
  /** Collapses concurrent joins into a single mint. */
  private inFlight: Promise<IceServer[]> | null = null;
  private failedUntilMs = 0;

  constructor(configService: ConfigService) {
    this.config = configService.get<VoiceConfig>('voice') as VoiceConfig;
  }

  async getIceServers(): Promise<IceServer[]> {
    const { turn } = this.config;

    if (turn.static.urls.length) {
      return [
        {
          urls: turn.static.urls,
          username: turn.static.username,
          credential: turn.static.credential,
        },
      ];
    }

    if (!turn.keyId || !turn.apiToken) return [this.stunServer()];

    if (this.cached && Date.now() < this.cached.expiresAtMs) {
      return this.cached.iceServers;
    }

    if (Date.now() < this.failedUntilMs) return [this.stunServer()];

    // Assigned before the await so concurrent callers see it and share the mint.
    this.inFlight ??= this.mint().finally(() => {
      this.inFlight = null;
    });

    return this.inFlight;
  }

  private stunServer(): IceServer {
    return { urls: this.config.stunUrls };
  }

  private async mint(): Promise<IceServer[]> {
    const { turn } = this.config;

    try {
      const response = await fetch(
        `${CLOUDFLARE_TURN_API}/${turn.keyId}/credentials/generate-ice-servers`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${turn.apiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ttl: turn.ttl }),
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        },
      );

      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }

      const body = (await response.json()) as CloudflareIceResponse;
      // The API answers with a single object; older docs show an array. Take both.
      const iceServers = body.iceServers ? [body.iceServers].flat() : [];

      if (!iceServers.length) throw new Error('no iceServers in response');

      this.cached = {
        iceServers,
        expiresAtMs:
          Date.now() + Math.max(turn.ttl - REFRESH_MARGIN_SECONDS, 1) * 1000,
      };
      this.failedUntilMs = 0;

      return iceServers;
    } catch (error) {
      this.failedUntilMs = Date.now() + FAILURE_BACKOFF_MS;
      this.logger.error(
        `Could not mint Cloudflare TURN credentials, falling back to STUN: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      return [this.stunServer()];
    }
  }
}
