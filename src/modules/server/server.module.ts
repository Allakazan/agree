import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Server, ServerSchema } from './schemas/server.schema';
import { ServerController } from './server.controller';
import { ServerService } from './server.service';
import { UsersModule } from '../users/users.module';
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Server.name, schema: ServerSchema }]),
    UsersModule,
  ],
  controllers: [ServerController],
  providers: [ServerService],
})
export class ServerModule {}
