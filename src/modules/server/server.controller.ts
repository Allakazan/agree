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
import { CreateEmojiDto } from './dto/create-emoji.dto';
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

  // The full list rides along with `GET /server` (`emojis` on each server), so
  // there is no read route here — only the two writes.
  @Post(':serverId/emojis')
  async createEmoji(
    @Param('serverId') serverId: string,
    @Body() dto: CreateEmojiDto,
    @User() user: LoggedUser,
  ) {
    const emoji = await this.serverService.createEmoji(serverId, user.sub, dto);
    return {
      _id: String(emoji._id),
      name: emoji.name,
      url: emoji.url,
      createdBy: String(emoji.createdBy),
    };
  }

  @Delete(':serverId/emojis/:emojiId')
  @HttpCode(204)
  removeEmoji(
    @Param('serverId') serverId: string,
    @Param('emojiId') emojiId: string,
    @User() user: LoggedUser,
  ) {
    return this.serverService.removeEmoji(serverId, user.sub, emojiId);
  }
}
