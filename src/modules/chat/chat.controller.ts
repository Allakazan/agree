import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ChatService } from './chat.service';
import { ListAllMessages } from './dto/chat.dto';
import { ApiBearerAuth } from '@nestjs/swagger';
import { User } from 'src/modules/auth/decorators/user.decorator';
import { LoggedUser } from 'src/modules/auth/types/loggedUser.type';

@Controller('chat')
@ApiBearerAuth()
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Get('/conversations')
  async findConversations(
    @User() user: LoggedUser,
    @Query() query: ListAllMessages,
  ) {
    return this.chatService.findConversationsForUser(user.sub, query);
  }

  @Get('/conversations/:conversationId')
  async findConversationMessages(
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @User() user: LoggedUser,
    @Query() query: ListAllMessages,
  ) {
    return this.chatService.findAllByConversation(
      conversationId,
      user.sub,
      query,
    );
  }

  @Get('/:channelId')
  async find(
    @Param('channelId') channelId: string,
    @Query() query: ListAllMessages,
  ) {
    return this.chatService.findAllByChannel(channelId, query);
  }
}
