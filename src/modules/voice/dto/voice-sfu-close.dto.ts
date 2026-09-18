import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsString,
} from 'class-validator';
import { IsObjectID } from 'src/common/decorators/isObjectID';

/**
 * Closes tracks on the caller's own session — published ones (which unpublishes
 * them for the room) and pulled ones alike.
 *
 * **There is no offer, and no renegotiation.** Cloudflare gets `force: true`,
 * which leaves a dead transceiver on the client — and that is the point. A
 * close that renegotiates makes the client offer the m-section with port 0,
 * which frees the slot for Cloudflare to recycle the mid on its next offer
 * (a pull) with a fresh set of header-extension ids. Chrome keeps the
 * extension map per mid for the life of the `RTCPeerConnection` and refuses
 * the remap — `RTP extension ID reassignment not supported (collision on
 * active MID n)` — which killed every negotiation on that PC from then on.
 * Nobody ever offering port 0 is what keeps that mid out of reach.
 */
export class VoiceSfuCloseDto {
  @IsString()
  @IsObjectID()
  @ApiProperty()
  channelId: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(64)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @ApiProperty({ type: [String] })
  mids: string[];
}
