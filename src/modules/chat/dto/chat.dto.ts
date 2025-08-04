import { ApiProperty } from '@nestjs/swagger';
import {
  IsNumber,
  IsPositive,
  IsString,
  IsTimeZone,
  IsISO8601,
  Max,
  MaxLength,
} from 'class-validator';
import { IsObjectID } from 'src/common/decorators/isObjectID';

const MESSAGE_MAX_CHARACTERS = 1024;

export class ChatMessageDto {
  @IsString()
  @MaxLength(MESSAGE_MAX_CHARACTERS)
  message: string;

  @IsString()
  @IsObjectID()
  channelId: string;
}

export class ListAllMessages {
  @IsNumber()
  @IsPositive()
  @Max(50)
  @ApiProperty()
  limit: number;

  @IsString()
  @IsISO8601()
  @ApiProperty()
  before: string;
}
