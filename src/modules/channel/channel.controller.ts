import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { ChannelService } from './channel.service';
import { CreateChannelDto } from './dto/create-channel.dto';

@Controller('server/:serverId/channel')
@ApiBearerAuth()
export class ChannelController {
  constructor(private readonly channelService: ChannelService) {}

  @Post()
  create(@Param('serverId') serverId: string, @Body() dto: CreateChannelDto) {
    return this.channelService.create(serverId, dto);
  }

  @Get()
  findAll(@Param('serverId') serverId: string) {
    return this.channelService.findAllByServer(serverId);
  }
}
