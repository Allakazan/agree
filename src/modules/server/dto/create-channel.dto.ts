import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString } from 'class-validator';
import { ChannelType } from '../schemas/channel.schema';

export class CreateChannelDto {
  @IsString()
  @ApiProperty()
  name: string;

  @IsEnum(ChannelType)
  @ApiProperty({ enum: ChannelType })
  type: ChannelType;
}
