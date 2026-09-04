import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { SignInDto } from './dto/signin.dto';
import { ApiBearerAuth } from '@nestjs/swagger';
import { Public } from './decorators/ispublic.decorator';
import { User } from './decorators/user.decorator';
import { LoggedUser } from './types/loggedUser.type';

@Controller('auth')
@ApiBearerAuth()
export class AuthController {
  constructor(private authService: AuthService) {}

  @HttpCode(HttpStatus.OK)
  @Post('login')
  @Public()
  signIn(@Body() { login, password }: SignInDto) {
    return this.authService.signIn(login, password);
  }

  @Get('profile')
  getProfile(@User() user: LoggedUser) {
    return user;
  }
}
