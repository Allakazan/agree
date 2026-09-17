import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsIn,
  IsNotEmpty,
  IsString,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { IsObjectID } from 'src/common/decorators/isObjectID';
import {
  VOICE_CONTENT_HINTS,
  VOICE_TRACK_SOURCES,
  VoiceContentHint,
  VoiceTrackSource,
} from '../types/voice.types';
import { SdpOfferDto } from './session-description.dto';

export class VoiceSfuPublishTrackDto {
  /** The transceiver's mid in the client's offer. */
  @IsString()
  @IsNotEmpty()
  @ApiProperty()
  mid: string;

  /** Also the track's name on the SFU; the server derives its kind from it. */
  @IsIn(VOICE_TRACK_SOURCES)
  @ApiProperty({ enum: VOICE_TRACK_SOURCES })
  source: VoiceTrackSource;

  /** Required for a screenshare — it picks the ladder. Ignored otherwise. */
  @ValidateIf((track: VoiceSfuPublishTrackDto) => track.source === 'screen')
  @IsIn(VOICE_CONTENT_HINTS)
  @ApiProperty({ enum: VOICE_CONTENT_HINTS, required: false })
  contentHint?: VoiceContentHint;
}

/**
 * Publishes local tracks to the SFU. The offer is inspected (codecs, simulcast
 * layers, media kind per mid) before it is forwarded, never rewritten.
 */
export class VoiceSfuPublishDto {
  @IsString()
  @IsObjectID()
  @ApiProperty()
  channelId: string;

  // `@ValidateNested` alone lets a missing object through.
  @IsDefined()
  @ValidateNested()
  @Type(() => SdpOfferDto)
  @ApiProperty({ type: SdpOfferDto })
  sessionDescription: SdpOfferDto;

  // One per source at most, so four is the most a single publish can hold.
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(VOICE_TRACK_SOURCES.length)
  @ValidateNested({ each: true })
  @Type(() => VoiceSfuPublishTrackDto)
  @ApiProperty({ type: [VoiceSfuPublishTrackDto] })
  tracks: VoiceSfuPublishTrackDto[];
}
