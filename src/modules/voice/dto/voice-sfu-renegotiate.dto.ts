import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDefined, IsString, ValidateNested } from 'class-validator';
import { IsObjectID } from 'src/common/decorators/isObjectID';
import { SdpAnswerDto } from './session-description.dto';

/** The client's answer to an offer Cloudflare made (after a pull or close). */
export class VoiceSfuRenegotiateDto {
  @IsString()
  @IsObjectID()
  @ApiProperty()
  channelId: string;

  // `@ValidateNested` alone lets a missing object through.
  @IsDefined()
  @ValidateNested()
  @Type(() => SdpAnswerDto)
  @ApiProperty({ type: SdpAnswerDto })
  sessionDescription: SdpAnswerDto;
}
