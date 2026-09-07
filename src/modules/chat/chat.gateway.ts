import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ChannelSubscriptionDto, ChatMessageDto } from './dto/chat.dto';
import { BadRequestException, UseFilters, UseGuards } from '@nestjs/common';
import { WsValidationPipe } from 'src/common/pipes/ws-validation.pipe';
import { WsGlobalExceptionFilter } from 'src/common/filters/ws-exception.filter';
import { ChatService } from './chat.service';
import { User } from 'src/modules/auth/decorators/user.decorator';
import { LoggedUser } from 'src/modules/auth/types/loggedUser.type';
import { AuthGuard } from 'src/modules/auth/guards/auth.guard';
import { WsAuthService } from 'src/modules/auth/ws-auth.service';
import { ServerService } from '../server/server.service';
import { channelRoom, userRoom } from './chat.rooms';

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
export class ChatGateway implements OnGatewayConnection {
  constructor(
    private readonly chatService: ChatService,
    private readonly serverService: ServerService,
    private readonly wsAuthService: WsAuthService,
  ) {}

  @WebSocketServer()
  server: Server;

  async handleConnection(client: Socket): Promise<void> {
    const user = await this.wsAuthService.authenticate(client);

    if (!user) {
      client.emit('error', { status: 'error', message: 'Unauthorized' });
      client.disconnect(true);
      return;
    }

    (client.data as { user: LoggedUser }).user = user;

    await client.join(userRoom(user.sub));
  }

  @SubscribeMessage('subscribe')
  async handleSubscribe(
    @MessageBody(new WsValidationPipe()) dto: ChannelSubscriptionDto,
    @ConnectedSocket() client: Socket,
    @User() user: LoggedUser,
  ): Promise<{ status: string; channelId: string }> {
    const room = channelRoom(dto.channelId);

    if (!client.rooms.has(room)) {
      const isMember = await this.serverService.isUserMemberOfChannelServer(
        user.sub,
        dto.channelId,
      );

      if (!isMember) {
        // BadRequestException, not Forbidden: WsGlobalExceptionFilter only
        // unwraps BadRequestException/WsException, anything else reaches the
        // client as a generic "Internal server error".
        throw new BadRequestException(
          "You are not a member of this channel's server",
        );
      }

      await client.join(room);
    }

    return { status: 'subscribed', channelId: dto.channelId };
  }

  @SubscribeMessage('unsubscribe')
  async handleUnsubscribe(
    @MessageBody(new WsValidationPipe()) dto: ChannelSubscriptionDto,
    @ConnectedSocket() client: Socket,
  ): Promise<{ status: string; channelId: string }> {
    await client.leave(channelRoom(dto.channelId));

    return { status: 'unsubscribed', channelId: dto.channelId };
  }

  @SubscribeMessage('chat')
  async handleEvent(
    @MessageBody(new WsValidationPipe()) dto: ChatMessageDto,
    @ConnectedSocket() client: Socket,
    @User() user: LoggedUser,
  ): Promise<any> {
    const room = dto.channelId ? channelRoom(dto.channelId) : undefined;

    if (room && !client.rooms.has(room)) {
      throw new BadRequestException(
        'Subscribe to this channel before sending messages',
      );
    }

    try {
      const { message, recipients } =
        await this.chatService.createMessagesAndConversation(
          dto,
          user.sub,
          user.username,
        );

      const payload = {
        ...message,
        createdAt: message.createdAt?.toISOString(),
      };

      if (room) {
        this.server.to(room).emit(`channel:${dto.channelId}:messages`, payload);
      } else {
        // `to()` de-duplicates sockets across rooms, so a participant on
        // several devices still gets exactly one copy per socket.
        this.server
          .to(recipients.map(userRoom))
          .emit(`conversation:${message.conversationId}:messages`, payload);
      }

      return message;
    } catch (error) {
      console.error(error);
      throw new BadRequestException(
        (error instanceof Error && error.message) ||
          'Error at the message socket',
      );
    }
  }
}
