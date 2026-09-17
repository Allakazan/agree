import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { IsObjectID } from 'src/common/decorators/isObjectID';
import {
  SIMULCAST_RIDS,
  SimulcastRid,
  VOICE_TRACK_SOURCES,
  VoiceTrackSource,
} from '../types/voice.types';

/**
 * One track to receive, addressed by publisher and name — never by Cloudflare
 * session id, which the client never learns. The server resolves the publisher
 * through presence, so only someone in the room can be pulled from.
 */
export class VoiceSfuPullTrackDto {
  @IsString()
  @IsObjectID()
  @ApiProperty()
  userId: string;

  @IsIn(VOICE_TRACK_SOURCES)
  @ApiProperty({ enum: VOICE_TRACK_SOURCES })
  trackName: VoiceTrackSource;

  /**
   * Video only. Must be one of the publisher's layers; defaults to the
   * cheapest, since this is where the egress bill lives.
   */
  @IsOptional()
  @IsIn(SIMULCAST_RIDS)
  @ApiProperty({ enum: SIMULCAST_RIDS, required: false })
  preferredRid?: SimulcastRid;
}

/** Batched, so a late joiner pulls a whole room in one negotiation. */
export class VoiceSfuPullDto {
  @IsString()
  @IsObjectID()
  @ApiProperty()
  channelId: string;

  // Cloudflare accepts at most 64 tracks per call.
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(64)
  @ValidateNested({ each: true })
  @Type(() => VoiceSfuPullTrackDto)
  @ApiProperty({ type: [VoiceSfuPullTrackDto] })
  tracks: VoiceSfuPullTrackDto[];
}
