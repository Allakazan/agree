import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsNotEmpty,
  IsString,
  ValidateNested,
} from 'class-validator';
import { IsObjectID } from 'src/common/decorators/isObjectID';
import { SdpOfferDto } from './session-description.dto';

/**
 * Closes tracks on the caller's own session — published ones (which unpublishes
 * them for the room) and pulled ones alike.
 *
 * The offer is required: the client stops the transceivers, offers, and
 * applies the answer, so both ends drop the m-sections together. Cloudflare
 * also has a `force` mode (stop the data flow, no renegotiation), but it would
 * leave a dead transceiver on the client, so this contract has one close only.
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

  @IsDefined()
  @ValidateNested()
  @Type(() => SdpOfferDto)
  @ApiProperty({ type: SdpOfferDto })
  sessionDescription: SdpOfferDto;
}
