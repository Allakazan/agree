import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VoiceConfig } from 'src/config/voice';
import { describeSdp } from './voice.sdp';

const CLOUDFLARE_SFU_API = 'https://rtc.live.cloudflare.com/v1/apps';

const FETCH_TIMEOUT_MS = 10_000;

export type SessionDescription = {
  type: 'offer' | 'answer';
  sdp: string;
};

export type SfuSimulcast = {
  preferredRid?: string;
  priorityOrdering?: 'none' | 'asciibetical';
  ridNotAvailable?: 'none' | 'asciibetical';
};

/** Cloudflare's `TrackObject`, request and response alike. */
export type SfuTrack = {
  location?: 'local' | 'remote';
  mid?: string;
  sessionId?: string;
  trackName?: string;
  simulcast?: SfuSimulcast;
  errorCode?: string;
  errorDescription?: string;
};

export type SfuTracksResponse = {
  tracks?: SfuTrack[];
  sessionDescription?: SessionDescription;
  requiresImmediateRenegotiation?: boolean;
};

type SfuErrorBody = {
  errorCode?: string;
  errorDescription?: string;
};

/**
 * Anything the SFU refused: a non-2xx, an error in the body, or an error on
 * any single track. Cloudflare reports the last two with HTTP 200, so a status
 * check alone would miss them.
 */
export class SfuRequestError extends Error {}

/**
 * A thin client over the Cloudflare Realtime SFU HTTPS API — one method per
 * endpoint, no policy. Plain `fetch`, as with TURN: there is no official npm
 * package.
 *
 * Unlike `VoiceIceService`, this **throws**. A missing TURN relay can degrade
 * to STUN; a failed publish has no degraded mode, so the caller must hear
 * about it.
 *
 * The app secret is used here and nowhere else. It never reaches a client:
 * every SFU operation is proxied through the voice gateway, which is what lets
 * the server decide who may pull which track.
 */
@Injectable()
export class CloudflareSfuClient {
  private readonly logger = new Logger(CloudflareSfuClient.name);
  private readonly config: VoiceConfig['sfu'];

  constructor(configService: ConfigService) {
    this.config = (configService.get<VoiceConfig>('voice') as VoiceConfig).sfu;
  }

  /** Opens a session: one per `RTCPeerConnection` on the client. */
  async createSession(): Promise<string> {
    const body = await this.request<{ sessionId?: string }>(
      'POST',
      'sessions/new',
    );

    if (!body.sessionId) throw new SfuRequestError('no sessionId in response');
    return body.sessionId;
  }

  /** Publishes the client's local tracks; answers the client's offer. */
  pushTracks(
    sessionId: string,
    offer: SessionDescription,
    tracks: { mid: string; trackName: string }[],
  ): Promise<SfuTracksResponse> {
    return this.tracksRequest('POST', sessionId, 'tracks/new', {
      sessionDescription: offer,
      tracks: tracks.map((track) => ({ location: 'local', ...track })),
    });
  }

  /**
   * Pulls other sessions' tracks into this one. Cloudflare answers with an
   * offer of its own when the client must renegotiate.
   */
  pullTracks(
    sessionId: string,
    tracks: {
      sessionId: string;
      trackName: string;
      simulcast?: SfuSimulcast;
    }[],
  ): Promise<SfuTracksResponse> {
    return this.tracksRequest('POST', sessionId, 'tracks/new', {
      tracks: tracks.map((track) => ({ location: 'remote', ...track })),
    });
  }

  /** Completes a negotiation Cloudflare started, with the client's answer. */
  async renegotiate(
    sessionId: string,
    answer: SessionDescription,
  ): Promise<SessionDescription | undefined> {
    const body = await this.request<{
      sessionDescription?: SessionDescription;
    }>('PUT', `sessions/${encodeURIComponent(sessionId)}/renegotiate`, {
      sessionDescription: answer,
    });

    return body.sessionDescription;
  }

  /**
   * Closes tracks by mid, renegotiating with the client's offer.
   *
   * `force` is **required** by the live API, whatever the OpenAPI spec says —
   * checked against it directly: a body without `force` gets `400
   * decoding_error ... force`, and `force: false` without an offer gets `406
   * sessionDescription must be present`. `sessionDescription` + `force: false`
   * is the spec's own example.
   */
  closeTracks(
    sessionId: string,
    mids: string[],
    offer: SessionDescription,
  ): Promise<SfuTracksResponse> {
    return this.tracksRequest('PUT', sessionId, 'tracks/close', {
      tracks: mids.map((mid) => ({ mid })),
      sessionDescription: offer,
      force: false,
    });
  }

  /** Changes existing transceivers in place — here, a pull's simulcast layer. */
  updateTracks(
    sessionId: string,
    tracks: SfuTrack[],
  ): Promise<SfuTracksResponse> {
    return this.tracksRequest('PUT', sessionId, 'tracks/update', { tracks });
  }

  private async tracksRequest(
    method: 'POST' | 'PUT',
    sessionId: string,
    path: string,
    body: unknown,
  ): Promise<SfuTracksResponse> {
    const response = await this.request<SfuTracksResponse>(
      method,
      `sessions/${encodeURIComponent(sessionId)}/${path}`,
      body,
    );

    const failed = response.tracks?.find((track) => track.errorCode);
    if (failed) {
      throw new SfuRequestError(
        `track ${failed.trackName ?? failed.mid ?? '?'}: ${failed.errorCode} ${
          failed.errorDescription ?? ''
        }`.trim(),
      );
    }

    return response;
  }

  private async request<T>(
    method: 'POST' | 'PUT',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const { appId, appSecret } = this.config;
    if (!appId || !appSecret) {
      throw new SfuRequestError('Cloudflare Realtime SFU is not configured');
    }
    this.logger.debug(`→ ${method} ${path} ${summarize(body)}`);

    const response = await fetch(
      `${CLOUDFLARE_SFU_API}/${encodeURIComponent(appId)}/${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${appSecret}`,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      },
    );

    const parsed = (await response.json().catch(() => ({}))) as T &
      SfuErrorBody;

    this.logger.debug(
      `← ${response.status} ${method} ${path} ${summarize(parsed)}`,
    );

    if (!response.ok || parsed.errorCode) {
      throw new SfuRequestError(
        `${method} ${path}: ${response.status} ${
          parsed.errorCode ?? response.statusText
        } ${parsed.errorDescription ?? ''}`.trim(),
      );
    }

    return parsed;
  }
}

/** A request or response body for the debug log: SDP summarized, tracks as `mid/name`. */
const summarize = (payload: unknown): string => {
  if (!payload || typeof payload !== 'object') return '';

  const {
    sessionId,
    sessionDescription,
    tracks,
    force,
    requiresImmediateRenegotiation,
    errorCode,
    errorDescription,
  } = payload as SfuTracksResponse &
    SfuErrorBody & { sessionId?: string; force?: boolean };

  const parts: string[] = [];
  if (sessionId) parts.push(`sessionId=${sessionId}`);
  if (tracks) {
    const described = tracks.map((track) =>
      [
        track.location,
        track.mid ?? '-',
        track.trackName ?? '-',
        track.simulcast?.preferredRid,
        track.errorCode,
      ]
        .filter(Boolean)
        .join('/'),
    );
    parts.push(`tracks=[${described.join(', ')}]`);
  }
  if (force !== undefined) parts.push(`force=${force}`);
  if (requiresImmediateRenegotiation !== undefined) {
    parts.push(`renegotiate=${requiresImmediateRenegotiation}`);
  }
  if (sessionDescription) {
    parts.push(
      `${sessionDescription.type}{${describeSdp(sessionDescription.sdp)}}`,
    );
  }
  if (errorCode) parts.push(`error=${errorCode} ${errorDescription ?? ''}`);

  return parts.join(' ');
};
