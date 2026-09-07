import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNumber,
  IsPositive,
  IsString,
  IsISO8601,
  Max,
  MaxLength,
  IsOptional,
  IsArray,
  ArrayMinSize,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IsObjectID } from 'src/common/decorators/isObjectID';
import { IsExactlyOneOf } from 'src/common/decorators/isExactlyOneOf';

const MESSAGE_MAX_CHARACTERS = 1024;

export class ChatMessageDto {
  @IsString()
  @MaxLength(MESSAGE_MAX_CHARACTERS)
  // IsExactlyOneOf lives here, not on channelId/recipientIds, because
  // @ValidateIf on those fields would skip it too when both are sent
  // (ValidateIf gates every validator on the same property).
  @IsExactlyOneOf(['channelId', 'recipientIds'])
  message: string;

  @ValidateIf((o: ChatMessageDto) => o.recipientIds === undefined)
  @IsString()
  @IsObjectID()
  @ApiPropertyOptional()
  channelId?: string;

  @ValidateIf((o: ChatMessageDto) => o.channelId === undefined)
  @IsArray()
  @ArrayMinSize(1)
  @IsObjectID({ each: true })
  @ApiPropertyOptional({ type: [String] })
  recipientIds?: string[];
}

export class ChannelSubscriptionDto {
  @IsString()
  @IsObjectID()
  @ApiProperty()
  channelId: string;
}

export class ListAllMessages {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  @Max(50)
  @ApiPropertyOptional({ example: 20, default: 20 })
  limit: number = 20;

  @IsOptional()
  @IsString()
  @IsISO8601()
  @ApiPropertyOptional({
    example: '2025-08-10T18:00:00.000Z',
    description: 'Filter messages before this UTC date',
  })
  before?: string;
}
