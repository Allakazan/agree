import { BadRequestException, Body, Controller, Get, Post } from '@nestjs/common';
import { ServerService } from './server.service';
import { CreateServerDto } from './dto/create-server.dto';

@Controller('server')
export class ServerController {
  constructor(private readonly serverService: ServerService) {}

  @Post()
  async create(@Body() createServerDto: CreateServerDto) {
    try {
      return this.serverService.create(createServerDto);
    } catch (error) {
      throw new BadRequestException(error)
    }
  }

  @Get('/')
  async find() {
    return await this.serverService.findAll();
  }
}
