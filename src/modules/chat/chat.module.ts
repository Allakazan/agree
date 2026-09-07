import { Module } from '@nestjs/common';
import { ChatGateway } from './chat.gateway';
import { DrizzleModule } from 'src/drizzle/drizzle.module';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';
import { AuthGuard } from 'src/modules/auth/guards/auth.guard';
import { ServerModule } from '../server/server.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [DrizzleModule, ServerModule, UsersModule],
  controllers: [ChatController],
  providers: [ChatService, ChatGateway, AuthGuard],
})
export class ChatModule {}
