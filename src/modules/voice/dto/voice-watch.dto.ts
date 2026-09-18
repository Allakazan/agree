import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { IsObjectID } from 'src/common/decorators/isObjectID';

/**
 * `voice:watch` and `voice:unwatch` carry the same payload — the server whose
 * voice channels the client wants to see populated in its sidebar, without
 * being in any of them.
 */
export class VoiceWatchDto {
  @IsString()
  @IsObjectID()
  @ApiProperty()
  serverId: string;
}
