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
import { Public } from './decorators/ispublic.decorator';
import { User } from './decorators/user.decorator';
import { LoggedUser } from './types/loggedUser.type';
import { clearTokenCookie, setTokenCookie } from './token-cookie';

@Controller('auth')
@ApiBearerAuth()
export class AuthController {
  constructor(private authService: AuthService) {}

  @HttpCode(HttpStatus.OK)
  @Post('login')
  @Public()
  async signIn(
    @Body() { login, password }: SignInDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { access_token } = await this.authService.signIn(login, password);
    setTokenCookie(res, access_token);
    return { ok: true };
  }

  @HttpCode(HttpStatus.OK)
  @Post('logout')
  @Public()
  logout(@Res({ passthrough: true }) res: Response) {
    clearTokenCookie(res);
    return { ok: true };
  }

  @Get('profile')
  getProfile(@User() user: LoggedUser) {
    return user;
  }
}
