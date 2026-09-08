import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VoiceConfig } from 'src/config/voice';
import { VoiceIceService } from './voice.ice.service';

const configWith = (turn: Partial<VoiceConfig['turn']> = {}): ConfigService => {
  const config: VoiceConfig = {
    meshMax: 5,
    videoMeshMax: 2,
    maxAudioBitrate: 40_000,
    uplinkBudget: 200_000,
    turn: { static: { urls: [] }, ttl: 3600, ...turn },
    stunUrls: ['stun:stun.example:3478'],
  };

  return { get: () => config } as unknown as ConfigService;
};

const respondWith = (body: unknown, ok = true) =>
  Promise.resolve({
    ok,
    status: 500,
    statusText: 'Internal Server Error',
    json: () => Promise.resolve(body),
  } as Response);

describe('VoiceIceService', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('serves STUN only when no TURN is configured', async () => {
    const ice = new VoiceIceService(configWith());

    expect(await ice.getIceServers()).toEqual([
      { urls: ['stun:stun.example:3478'] },
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('prefers a static TURN server over Cloudflare, and pairs it with no STUN entry', async () => {
    const ice = new VoiceIceService(
      configWith({
        static: {
          urls: ['turn:localhost:3478'],
          username: 'bruno',
          credential: 'secret',
        },
        keyId: 'key-id',
        apiToken: 'token',
      }),
    );

    // A TURN server answers STUN too — its Allocate response carries the
    // server-reflexive candidate — so a separate stun: entry gathers nothing.
    expect(await ice.getIceServers()).toEqual([
      {
        urls: ['turn:localhost:3478'],
        username: 'bruno',
        credential: 'secret',
      },
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe('Cloudflare', () => {
    const cloudflare = () => configWith({ keyId: 'key-id', apiToken: 'token' });

    const minted = {
      urls: ['turn:turn.cloudflare.com:3478'],
      username: 'minted',
      credential: 'minted-secret',
    };

    it('mints credentials and normalizes the single-object response', async () => {
      fetchMock.mockReturnValue(respondWith({ iceServers: minted }));
      const ice = new VoiceIceService(cloudflare());

      expect(await ice.getIceServers()).toEqual([minted]);

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(
        'https://rtc.live.cloudflare.com/v1/turn/keys/key-id/credentials/generate-ice-servers',
      );
      expect(init.method).toBe('POST');
      expect(init.body).toBe(JSON.stringify({ ttl: 3600 }));
    });

    it('accepts an array response unchanged', async () => {
      fetchMock.mockReturnValue(respondWith({ iceServers: [minted, minted] }));
      const ice = new VoiceIceService(cloudflare());

      expect(await ice.getIceServers()).toHaveLength(2);
    });

    it('caches the credential instead of minting per join', async () => {
      fetchMock.mockReturnValue(respondWith({ iceServers: minted }));
      const ice = new VoiceIceService(cloudflare());

      await ice.getIceServers();
      await ice.getIceServers();

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('collapses concurrent joins into one mint', async () => {
      fetchMock.mockReturnValue(respondWith({ iceServers: minted }));
      const ice = new VoiceIceService(cloudflare());

      await Promise.all([
        ice.getIceServers(),
        ice.getIceServers(),
        ice.getIceServers(),
      ]);

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('degrades to STUN when the API fails, rather than failing the join', async () => {
      fetchMock.mockReturnValue(respondWith({}, false));
      const ice = new VoiceIceService(cloudflare());

      expect(await ice.getIceServers()).toEqual([
        { urls: ['stun:stun.example:3478'] },
      ]);
    });

    it('degrades to STUN when the response carries no iceServers', async () => {
      fetchMock.mockReturnValue(respondWith({}));
      const ice = new VoiceIceService(cloudflare());

      expect(await ice.getIceServers()).toEqual([
        { urls: ['stun:stun.example:3478'] },
      ]);
    });

    it('backs off after a failure so a join storm cannot hammer the API', async () => {
      fetchMock.mockReturnValue(respondWith({}, false));
      const ice = new VoiceIceService(cloudflare());

      await ice.getIceServers();
      await ice.getIceServers();

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
