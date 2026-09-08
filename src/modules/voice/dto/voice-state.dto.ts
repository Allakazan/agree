import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsString } from 'class-validator';
import { IsObjectID } from 'src/common/decorators/isObjectID';

/**
 * Mute / deafen. The server keeps this on the participant row purely so a late
 * joiner renders the right icons — muting is enforced by the client on its own
 * track, and a server that "knows" someone is muted cannot make it so.
 */
export class VoiceStateDto {
  @IsString()
  @IsObjectID()
  @ApiProperty()
  channelId: string;

  @IsBoolean()
  @ApiProperty()
  muted: boolean;

  /** Deafened implies muted on every client, but the two are stored apart. */
  @IsBoolean()
  @ApiProperty()
  deafened: boolean;
}
