import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Channel, ChannelSchema } from './schemas/channel.schema';
import { ChannelController } from './channel.controller';
import { ChannelService } from './channel.service';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Channel.name, schema: ChannelSchema }]),
    UsersModule,
  ],
  controllers: [ChannelController],
  providers: [ChannelService],
  exports: [ChannelService],
})
export class ChannelModule {}
