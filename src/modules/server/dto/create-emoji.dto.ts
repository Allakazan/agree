import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUrl, Matches, MaxLength } from 'class-validator';
import { EMOJI_NAME_PATTERN } from '../schemas/emoji.schema';

export class CreateEmojiDto {
  @IsString()
  @Matches(EMOJI_NAME_PATTERN, {
    message: 'name must be 2-32 lowercase letters, digits or underscores',
  })
  @ApiProperty({ example: 'pepe', pattern: EMOJI_NAME_PATTERN.source })
  name: string;

  /** Where the image lives (png/gif/webp…). Only http(s); the backend never fetches it. */
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2048)
  @ApiProperty({ example: 'https://cdn.example.com/pepe.gif' })
  url: string;
}
