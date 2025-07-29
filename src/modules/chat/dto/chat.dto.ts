import { IsString, MaxLength } from 'class-validator';
import { IsObjectID } from 'src/common/decorators/isObjectID';

export class ChatMessageDto {
  @IsString()
  @MaxLength(1024) // Change that later
  message: string;

  @IsString()
  @IsObjectID()
  channelId: string;
}
