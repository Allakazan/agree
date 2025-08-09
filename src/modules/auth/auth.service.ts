import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';

import { UsersService } from '../users/users.service';
import { LoggedUser } from './types/loggedUser.type';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
  ) {}

  async signIn(login: string, pass: string): Promise<{ access_token: string }> {
    const user = await this.usersService.findOne({
      $or: [{ username: login }, { email: login }],
    });

    if (!user) throw new UnauthorizedException();

    if (!(await argon2.verify(user.password, pass)))
      throw new UnauthorizedException();

    const payload = { sub: user.id, username: user.username } as LoggedUser;
    return {
      access_token: await this.jwtService.signAsync(payload),
    };
  }
}
