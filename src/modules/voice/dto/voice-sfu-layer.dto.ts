import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString } from 'class-validator';
import { IsObjectID } from 'src/common/decorators/isObjectID';
import { SIMULCAST_RIDS, SimulcastRid } from '../types/voice.types';

/**
 * Switches a pulled video track to another simulcast layer. The client picks
 * the layer from the tile's rendered size; Cloudflare still downshifts on its
 * own under congestion.
 */
export class VoiceSfuLayerDto {
  @IsString()
  @IsObjectID()
  @ApiProperty()
  channelId: string;

  /** The pulled track's mid on the caller's session. */
  @IsString()
  @IsNotEmpty()
  @ApiProperty()
  mid: string;

  @IsIn(SIMULCAST_RIDS)
  @ApiProperty({ enum: SIMULCAST_RIDS })
  preferredRid: SimulcastRid;
}
