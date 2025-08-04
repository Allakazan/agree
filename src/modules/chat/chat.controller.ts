import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ChatService } from './chat.service';
import { ListAllMessages } from './dto/chat.dto';

@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Get('/:conversationId')
  async find(
    @Param('conversationId') id: string,
    @Query() query: ListAllMessages,
  ) {
    return this.chatService.findAll(id, query);
  }
}
