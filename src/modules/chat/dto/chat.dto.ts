import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNumber,
  IsPositive,
  IsString,
  IsTimeZone,
  IsISO8601,
  Max,
  MaxLength,
  IsOptional,
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
  @ApiProperty({ example: 20 })
  limit: number;

  @IsOptional()
  @IsString()
  @IsISO8601()
  @ApiPropertyOptional({
    example: '2025-08-10T18:00:00.000Z',
    description: 'Filter messages before this UTC date',
  })
  before?: string;
}
