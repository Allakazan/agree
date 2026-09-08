import { ApiProperty } from '@nestjs/swagger';
import { IsObjectID } from 'src/common/decorators/isObjectID';

export class AddMemberDto {
  @IsObjectID()
  @ApiProperty()
  userId: string;
}
