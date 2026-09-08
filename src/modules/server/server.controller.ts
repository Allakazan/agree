import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import { ServerService } from './server.service';
import { CreateServerDto } from './dto/create-server.dto';
import { CreateChannelDto } from './dto/create-channel.dto';
import { AddMemberDto } from './dto/add-member.dto';
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
  async find(@User() user: LoggedUser) {
    return await this.serverService.findAll(user.sub);
  }

  @Post(':serverId/channel')
  createChannel(
    @Param('serverId') serverId: string,
    @Body() dto: CreateChannelDto,
  ) {
    return this.serverService.createChannel(serverId, dto);
  }

  @Get(':serverId/channel')
  findChannels(@Param('serverId') serverId: string, @User() user: LoggedUser) {
    return this.serverService.findChannelsByServer(serverId, user.sub);
  }

  // Public fields only — same shape/reasoning as `UsersController.findAll`.
  @Get(':serverId/members')
  async findMembers(
    @Param('serverId') serverId: string,
    @User() user: LoggedUser,
  ) {
    const members = await this.serverService.findMembers(serverId, user.sub);
    return members.map((m) => ({
      id: String(m._id),
      username: m.username,
      profileImageUrl: m.profileImageUrl || null,
    }));
  }

  @Post(':serverId/members')
  addMember(
    @Param('serverId') serverId: string,
    @Body() dto: AddMemberDto,
    @User() user: LoggedUser,
  ) {
    return this.serverService.addMember(serverId, user.sub, dto.userId);
  }

  @Delete(':serverId/members/:userId')
  @HttpCode(204)
  removeMember(
    @Param('serverId') serverId: string,
    @Param('userId') targetUserId: string,
    @User() user: LoggedUser,
  ) {
    return this.serverService.removeMember(serverId, user.sub, targetUserId);
  }
}
