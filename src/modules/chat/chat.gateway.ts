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
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { WsValidationPipe } from 'src/common/pipes/ws-validation.pipe';
import { WsGlobalExceptionFilter } from 'src/common/filters/ws-exception.filter';
import { DRIZZLE } from 'src/drizzle/drizzle.module';
import { DrizzleDB } from 'src/drizzle/types/drizzle';
import { ChatService } from './chat.service';
import { User } from 'src/modules/auth/decorators/user.decorator';
import { LoggedUser } from 'src/modules/auth/types/loggedUser.type';
import { AuthGuard } from 'src/modules/auth/guards/auth.guard';

@WebSocketGateway(4040, {
  namespace: 'chat',
  cors: {
    origin: process.env.ORIGIN
      ? process.env.ORIGIN.split(',')
      : ['http://localhost:3001', 'http://127.0.0.1:5500'], // agree-app (Next.js) + socket_debug.html defaults
    methods: ['GET', 'POST'],
    credentials: true,
  },
})
@UseFilters(new WsGlobalExceptionFilter())
@UseGuards(AuthGuard)
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
      const inserted = await this.chatService.createMessagesAndConversation(
        channelId,
        message,
        user.sub,
        user.username,
      );

      this.server.emit(`channel:${channelId}:messages`, {
        ...inserted,
        createdAt: inserted.createdAt?.toISOString(),
      });

      return inserted;
    } catch (error) {
      console.error(error);
      throw new BadRequestException(
        (error instanceof Error && error.message) ||
          'Error at the message socket',
      );
    }
  }
}
