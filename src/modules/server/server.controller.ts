import { Controller, Get } from '@nestjs/common';
import { ServerService } from './server.service';

@Controller('server')
export class ServerController {
  constructor(private readonly serverService: ServerService) {}

  @Get()
  async find() {
    return await this.serverService.findAll();
  }
}
