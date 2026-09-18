import { ConfigService } from '@nestjs/config';
import { VoiceConfig } from 'src/config/voice';
import { CloudflareSfuClient, SfuRequestError } from './voice.sfu.client';

const configWith = (sfu: VoiceConfig['sfu']): ConfigService => {
  const config: VoiceConfig = {
    meshMax: 5,
    sfuMax: 25,
    maxAudioBitrate: 40_000,
    uplinkBudget: 200_000,
    turn: { static: { urls: [] }, ttl: 3600 },
    stunUrls: ['stun:stun.example:3478'],
    sfu,
  };

  return { get: () => config } as unknown as ConfigService;
};

const respondWith = (body: unknown, status = 200) =>
  Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Bad Request',
    json: () => Promise.resolve(body),
  } as Response);

const API = 'https://rtc.live.cloudflare.com/v1/apps/app-id';
const offer = { type: 'offer' as const, sdp: 'v=0' };

describe('CloudflareSfuClient', () => {
  let fetchMock: jest.Mock;
  let client: CloudflareSfuClient;

  /** The parsed body and init of the nth fetch call. */
  const call = (n = 0) => {
    const [url, init] = fetchMock.mock.calls[n] as [string, RequestInit];
    return {
      url,
      method: init.method,
      headers: init.headers as Record<string, string>,
      body: init.body
        ? (JSON.parse(init.body as string) as unknown)
        : undefined,
    };
  };

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    client = new CloudflareSfuClient(
      configWith({ appId: 'app-id', appSecret: 'app-secret' }),
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('creates a session with the app secret as a bearer token', async () => {
    fetchMock.mockReturnValue(respondWith({ sessionId: 'session-1' }));

    expect(await client.createSession()).toBe('session-1');
    expect(call()).toMatchObject({
      url: `${API}/sessions/new`,
      method: 'POST',
      headers: { Authorization: 'Bearer app-secret' },
    });
  });

  it('pushes local tracks with the client offer', async () => {
    fetchMock.mockReturnValue(
      respondWith({
        sessionDescription: { type: 'answer', sdp: 'v=0 answer' },
        tracks: [{ mid: '0', trackName: 'mic' }],
      }),
    );

    const response = await client.pushTracks('session-1', offer, [
      { mid: '0', trackName: 'mic' },
    ]);

    expect(response.sessionDescription?.type).toBe('answer');
    expect(call()).toMatchObject({
      url: `${API}/sessions/session-1/tracks/new`,
      method: 'POST',
      body: {
        sessionDescription: offer,
        tracks: [{ location: 'local', mid: '0', trackName: 'mic' }],
      },
    });
  });

  it('pulls remote tracks by publisher session and name, with simulcast', async () => {
    fetchMock.mockReturnValue(
      respondWith({ requiresImmediateRenegotiation: true, tracks: [] }),
    );
    const simulcast = {
      preferredRid: 'q',
      priorityOrdering: 'asciibetical' as const,
      ridNotAvailable: 'asciibetical' as const,
    };

    await client.pullTracks('session-2', [
      { sessionId: 'session-1', trackName: 'camera', simulcast },
    ]);

    expect(call().body).toEqual({
      tracks: [
        {
          location: 'remote',
          sessionId: 'session-1',
          trackName: 'camera',
          simulcast,
        },
      ],
    });
  });

  it('closes with force, never with an offer', async () => {
    fetchMock.mockReturnValue(respondWith({ tracks: [] }));

    await client.closeTracks('session-1', ['0']);

    // The live API requires `force`: without it the body is refused with a 400
    // decoding_error, whatever the OpenAPI spec says. It is `true` here so the
    // close never renegotiates — an offer with a port-0 m-section frees the
    // mid for Cloudflare to recycle with new header-extension ids, which
    // Chrome refuses (see `VoiceSfuCloseDto`).
    expect(call()).toMatchObject({
      url: `${API}/sessions/session-1/tracks/close`,
      method: 'PUT',
    });
    expect(call().body).toEqual({
      tracks: [{ mid: '0' }],
      force: true,
    });
  });

  it('renegotiates with the client answer', async () => {
    fetchMock.mockReturnValue(respondWith({}));
    const answer = { type: 'answer' as const, sdp: 'v=0' };

    await client.renegotiate('session-1', answer);

    expect(call()).toMatchObject({
      url: `${API}/sessions/session-1/renegotiate`,
      method: 'PUT',
      body: { sessionDescription: answer },
    });
  });

  describe('errors', () => {
    it('throws on a non-2xx response', async () => {
      fetchMock.mockReturnValue(
        respondWith(
          { errorCode: 'bad_request', errorDescription: 'nope' },
          400,
        ),
      );

      await expect(client.createSession()).rejects.toThrow(SfuRequestError);
    });

    it('throws on an error in a 200 body', async () => {
      fetchMock.mockReturnValue(
        respondWith({ errorCode: 'session_error', errorDescription: 'gone' }),
      );

      await expect(
        client.renegotiate('session-1', { type: 'answer', sdp: 'v=0' }),
      ).rejects.toThrow('session_error');
    });

    it('throws on an error on a single track, even with HTTP 200', async () => {
      fetchMock.mockReturnValue(
        respondWith({
          tracks: [
            { mid: '0', trackName: 'mic' },
            {
              trackName: 'camera',
              errorCode: 'not_found',
              errorDescription: 'track not found',
            },
          ],
        }),
      );

      await expect(
        client.pullTracks('session-2', [
          { sessionId: 'session-1', trackName: 'camera' },
        ]),
      ).rejects.toThrow('track camera: not_found track not found');
    });

    it('refuses to call out when the SFU is not configured', async () => {
      const unconfigured = new CloudflareSfuClient(configWith({}));

      await expect(unconfigured.createSession()).rejects.toThrow(
        'not configured',
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
