import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { VoiceSfuCloseDto } from './voice-sfu-close.dto';
import { VoiceSfuPublishDto } from './voice-sfu-publish.dto';
import { VoiceSfuRenegotiateDto } from './voice-sfu-renegotiate.dto';

const channelId = '507f1f77bcf86cd799439011';
const offer = { type: 'offer', sdp: 'v=0' };
const answer = { type: 'answer', sdp: 'v=0' };

/** The properties `WsValidationPipe` would reject, for a plain socket payload. */
const invalid = async (
  dto: new () => object,
  body: object,
): Promise<string[]> =>
  (await validate(plainToInstance(dto, body))).map(({ property }) => property);

describe('SFU DTOs', () => {
  // `@ValidateNested` alone lets a missing object through: without
  // `@IsDefined` these bodies reached the handler and blew up there.
  describe('require their session description', () => {
    it('on publish', async () => {
      const tracks = [{ mid: '0', source: 'mic' }];

      expect(await invalid(VoiceSfuPublishDto, { channelId, tracks })).toEqual([
        'sessionDescription',
      ]);
      expect(
        await invalid(VoiceSfuPublishDto, {
          channelId,
          tracks,
          sessionDescription: offer,
        }),
      ).toEqual([]);
    });

    it('on renegotiate', async () => {
      expect(await invalid(VoiceSfuRenegotiateDto, { channelId })).toEqual([
        'sessionDescription',
      ]);
      expect(
        await invalid(VoiceSfuRenegotiateDto, {
          channelId,
          sessionDescription: answer,
        }),
      ).toEqual([]);
    });
  });

  it('refuses the wrong half of the negotiation', async () => {
    expect(
      await invalid(VoiceSfuPublishDto, {
        channelId,
        tracks: [{ mid: '0', source: 'mic' }],
        sessionDescription: answer,
      }),
    ).toEqual(['sessionDescription']);
    expect(
      await invalid(VoiceSfuRenegotiateDto, {
        channelId,
        sessionDescription: offer,
      }),
    ).toEqual(['sessionDescription']);
  });

  // The close is forced (`force: true`) precisely so no offer is ever sent:
  // one with a port-0 m-section frees the mid for Cloudflare to recycle with
  // new header-extension ids, which Chrome refuses for the life of the PC.
  it('takes no session description on close', async () => {
    expect(await invalid(VoiceSfuCloseDto, { channelId, mids: ['0'] })).toEqual(
      [],
    );
  });
});
