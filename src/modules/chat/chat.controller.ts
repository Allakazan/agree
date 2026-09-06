import { Controller, Get, Param, Query } from '@nestjs/common';
import { ChatService } from './chat.service';
import { ListAllMessages } from './dto/chat.dto';
import { ApiBearerAuth } from '@nestjs/swagger';

@Controller('chat')
@ApiBearerAuth()
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Get('/:channelId')
  async find(
    @Param('channelId') channelId: string,
    @Query() query: ListAllMessages,
  ) {
    return this.chatService.findAllByChannel(channelId, query);
  }
}
