import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { AppService } from './app.service';
import { Public } from './modules/auth/decorators/ispublic.decorator';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  // Health check route. Unthrottled: agree-app polls it while waiting for the
  // backend to come back, and a 429 there would read as "still down".
  @Public()
  @SkipThrottle()
  @Get('health')
  getHealth(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
