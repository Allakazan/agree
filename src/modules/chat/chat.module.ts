import { Module } from '@nestjs/common';
import { ChatGateway } from './chat.gateway';
import { DrizzleModule } from 'src/drizzle/drizzle.module';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';
import { AuthGuard } from 'src/modules/auth/guards/auth.guard';

@Module({
  imports: [DrizzleModule],
  controllers: [ChatController],
  providers: [ChatService, ChatGateway, AuthGuard],
})
export class ChatModule {}
