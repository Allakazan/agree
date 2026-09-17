import { ApiProperty } from '@nestjs/swagger';
import { Equals, IsNotEmpty, IsString } from 'class-validator';

/**
 * An `RTCSessionDescriptionInit` headed for the SFU. Split by `type` so each
 * event can only carry the half of the negotiation it expects — a publish
 * sends an offer, a renegotiation sends an answer — and a client cannot hand
 * Cloudflare the wrong one. Size is bounded by socket.io's own
 * `maxHttpBufferSize` (1 MB by default), far above any legitimate SDP.
 */
export class SdpOfferDto {
  @Equals('offer')
  @ApiProperty({ enum: ['offer'] })
  type: 'offer';

  @IsString()
  @IsNotEmpty()
  @ApiProperty()
  sdp: string;
}

export class SdpAnswerDto {
  @Equals('answer')
  @ApiProperty({ enum: ['answer'] })
  type: 'answer';

  @IsString()
  @IsNotEmpty()
  @ApiProperty()
  sdp: string;
}
