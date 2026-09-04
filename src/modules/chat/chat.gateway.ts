import {
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server } from 'socket.io';
import { ChatMessageDto } from './dto/chat.dto';
import {
  BadRequestException,
  Inject,
  UseFilters,
  UsePipes,
} from '@nestjs/common';
import { WsValidationPipe } from 'src/common/pipes/ws-validation.pipe';
import { WsGlobalExceptionFilter } from 'src/common/filters/ws-exception.filter';
import { DRIZZLE } from 'src/drizzle/drizzle.module';
import { DrizzleDB } from 'src/drizzle/types/drizzle';
import { ChatService } from './chat.service';
import { User } from 'src/modules/auth/decorators/user.decorator';
import { LoggedUser } from 'src/modules/auth/types/loggedUser.type';

@WebSocketGateway(4040, {
  namespace: 'chat',
  cors: {
    origin: 'http://127.0.0.1:5500', // ou '*', mas cuidado em produção
    methods: ['GET', 'POST'],
  },
})
@UseFilters(new WsGlobalExceptionFilter())
export class ChatGateway {
  constructor(
    @Inject(DRIZZLE) private readonly drizzleService: DrizzleDB,
    private readonly chatService: ChatService,
  ) {}

  @WebSocketServer()
  server: Server;

  @SubscribeMessage('chat')
  @UsePipes(new WsValidationPipe())
  async handleEvent(
    @MessageBody() { message, channelId }: ChatMessageDto,
    @User() user: LoggedUser,
  ): Promise<any> {
    try {
      await this.chatService.createMessagesAndConversation(
        channelId,
        message,
        user.sub,
      );

      this.server.emit(`channel:${channelId}:messages`, message);

      return true;
    } catch (error) {
      console.error(error);
      throw new BadRequestException(
        (error instanceof Error && error.message) ||
          'Error at the message socket',
      );
    }
  }
}
