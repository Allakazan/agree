import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { User } from '../auth/decorators/user.decorator';
import { LoggedUser } from '../auth/types/loggedUser.type';
import { UsersService } from './users.service';

@Controller('users')
@ApiBearerAuth()
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // Everyone except the caller, so a client can list who to start a DM with.
  // Only public fields — never password/email.
  @Get()
  async findAll(@User() user: LoggedUser) {
    const users = await this.usersService.findAllExcept(user.sub);

    return users.map((u) => ({
      id: String(u._id),
      username: u.username,
      profileImageUrl: u.profileImageUrl || null,
    }));
  }
}
