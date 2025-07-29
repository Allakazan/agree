import {
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server } from 'socket.io';
import { ChatMessageDto } from './dto/chat.dto';
import { UseFilters, UsePipes } from '@nestjs/common';
import { WsValidationPipe } from 'src/common/pipes/ws-validation.pipe';
import { WsGlobalExceptionFilter } from 'src/common/filters/ws-exception.filter';

@WebSocketGateway(4040, {
  namespace: 'chat',
  cors: {
    origin: 'http://127.0.0.1:5500', // ou '*', mas cuidado em produção
    methods: ['GET', 'POST'],
  },
})
@UseFilters(new WsGlobalExceptionFilter())
export class ChatGateway {
  @WebSocketServer()
  server: Server;

  @SubscribeMessage('chat')
  @UsePipes(new WsValidationPipe())
  handleEvent(@MessageBody() data: ChatMessageDto): any {
    console.log(data.message);
    console.log(data.channelId);

    this.server.emit(`channel:${data.channelId}:messages`, data.message);

    return data;
  }
}
