import { IsString } from 'class-validator';

export class CreateServerDto {
  @IsString()
  name: string;

  @IsString()
  description: string;

  @IsString()
  logoImg: string;

  @IsString()
  bannerImage: string;
}
