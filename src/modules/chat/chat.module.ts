import { Module } from '@nestjs/common';
import { ChatGateway } from './chat.gateway';
import { DrizzleModule } from 'src/drizzle/drizzle.module';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';

@Module({
  imports: [DrizzleModule],
  controllers: [ChatController],
  providers: [ChatService, ChatGateway],
})
export class ChatModule {}
