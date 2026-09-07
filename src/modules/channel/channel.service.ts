import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Channel, ChannelDocument } from './schemas/channel.schema';
import { CreateChannelDto } from './dto/create-channel.dto';
import { UsersService } from '../users/users.service';

@Injectable()
export class ChannelService {
  constructor(
    @InjectModel(Channel.name) private channelModel: Model<Channel>,
    private readonly usersService: UsersService,
  ) {}

  async create(serverId: string, dto: CreateChannelDto): Promise<Channel> {
    return new this.channelModel({ ...dto, serverId }).save();
  }

  async findAllByServer(serverId: string): Promise<Channel[]> {
    return this.channelModel.find({ serverId }).exec();
  }

  async findById(channelId: string): Promise<ChannelDocument | null> {
    return this.channelModel.findById(channelId).exec();
  }

  async isUserMemberOfChannelServer(
    userId: string,
    channelId: string,
  ): Promise<boolean> {
    const channel = await this.findById(channelId);
    if (!channel) return false;
    return this.usersService.isMemberOfServer(
      userId,
      channel.serverId.toString(),
    );
  }
}
