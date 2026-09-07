import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import { ServerService } from './server.service';
import { CreateServerDto } from './dto/create-server.dto';
import { CreateChannelDto } from './dto/create-channel.dto';
import { ApiBearerAuth } from '@nestjs/swagger';
import { User } from '../auth/decorators/user.decorator';
import { LoggedUser } from '../auth/types/loggedUser.type';

@Controller('server')
@ApiBearerAuth()
export class ServerController {
  constructor(private readonly serverService: ServerService) {}

  @Post()
  async create(
    @User() user: LoggedUser,
    @Body() createServerDto: CreateServerDto,
  ) {
    try {
      return await this.serverService.create(createServerDto, user.sub);
    } catch (error) {
      throw new BadRequestException(error);
    }
  }

  @Get('/')
  async find() {
    return await this.serverService.findAll();
  }

  @Post(':serverId/channel')
  createChannel(
    @Param('serverId') serverId: string,
    @Body() dto: CreateChannelDto,
  ) {
    return this.serverService.createChannel(serverId, dto);
  }

  @Get(':serverId/channel')
  findChannels(@Param('serverId') serverId: string) {
    return this.serverService.findChannelsByServer(serverId);
  }
}
