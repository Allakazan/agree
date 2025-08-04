import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class CreateServerDto {
  @IsString()
  @ApiProperty()
  name: string;

  @IsString()
  @ApiProperty()
  description: string;

  @IsString()
  @ApiProperty()
  logoImg: string;

  @IsString()
  @ApiProperty()
  bannerImage: string;
}
