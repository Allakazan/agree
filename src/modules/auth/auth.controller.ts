import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { SignInDto } from './dto/signin.dto';
import { ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { loginThrottle } from 'src/common/throttle';
import { Public } from './decorators/ispublic.decorator';
import { User } from './decorators/user.decorator';
import { LoggedUser } from './types/loggedUser.type';
import { clearTokenCookie, setTokenCookie } from './token-cookie';
import { UsersService } from '../users/users.service';

@Controller('auth')
@ApiBearerAuth()
export class AuthController {
  constructor(
    private authService: AuthService,
    private usersService: UsersService,
  ) {}

  /**
   * The token goes out twice, on purpose. The cookie serves a same-site
   * caller (Swagger, a future web build on the API's own domain); the body
   * serves agree-app, which is cross-site — it runs on `tauri.localhost`
   * against this backend on another origin, so a `SameSite=Lax` cookie is
   * neither stored nor sent there, and it authenticates by holding the token
   * itself (`Authorization: Bearer` on REST, socket.io `auth` on WS).
   */
  @HttpCode(HttpStatus.OK)
  @Post('login')
  @Public()
  @Throttle(loginThrottle)
  async signIn(
    @Body() { login, password }: SignInDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { access_token } = await this.authService.signIn(login, password);
    setTokenCookie(res, access_token);
    return { ok: true, access_token };
  }

  @HttpCode(HttpStatus.OK)
  @Post('logout')
  @Public()
  logout(@Res({ passthrough: true }) res: Response) {
    clearTokenCookie(res);
    return { ok: true };
  }

  // The JWT payload (`LoggedUser`) only carries `sub`/`username` — it's
  // never reissued just because a profile picture changed — so the picture
  // itself is looked up fresh from Mongo on every call instead.
  @Get('profile')
  async getProfile(@User() user: LoggedUser) {
    const dbUser = await this.usersService.findOne({ _id: user.sub });
    return {
      ...user,
      profileImageUrl: dbUser?.profileImageUrl || null,
    };
  }
}
