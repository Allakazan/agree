import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { Public } from './modules/auth/decorators/ispublic.decorator';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  // Health check route
  @Public()
  @Get('health')
  getHealth(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
