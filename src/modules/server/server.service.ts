import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Server } from './schemas/server.schema';
import { Channel } from './schemas/channel.schema';
import { Model } from 'mongoose';
import { CreateServerDto } from './dto/create-server.dto';
import { CreateChannelDto } from './dto/create-channel.dto';
import { UsersService } from '../users/users.service';
import { toObjectId } from '../../common/objectid';

@Injectable()
export class ServerService {
  constructor(
    @InjectModel(Server.name) private serverModel: Model<Server>,
    private readonly usersService: UsersService,
  ) {}

  async create(
    createServerDto: CreateServerDto,
    creatorId: string,
  ): Promise<Server> {
    const server = await new this.serverModel(createServerDto).save();
    await this.usersService.addServerId(creatorId, server._id.toString());
    return server;
  }

  async findAll(): Promise<Server[]> {
    return this.serverModel.find().exec();
  }

  async createChannel(
    serverId: string,
    dto: CreateChannelDto,
  ): Promise<Channel> {
    const updated = await this.serverModel
      .findByIdAndUpdate(
        serverId,
        { $push: { channels: dto } },
        { new: true, runValidators: true },
      )
      .exec();

    if (!updated) {
      throw new NotFoundException(`Server ${serverId} not found`);
    }

    return updated.channels[updated.channels.length - 1];
  }

  async findChannelsByServer(serverId: string): Promise<Channel[]> {
    const server = await this.serverModel
      .findById(serverId, { channels: 1 })
      .exec();

    if (!server) {
      throw new NotFoundException(`Server ${serverId} not found`);
    }

    return server.channels;
  }

  async isUserMemberOfChannelServer(
    userId: string,
    channelId: string,
  ): Promise<boolean> {
    const channelObjectId = toObjectId(channelId);
    if (!channelObjectId) return false;

    const server = await this.serverModel
      .findOne({ 'channels._id': channelObjectId }, { _id: 1 })
      .exec();

    if (!server) return false;
    return this.usersService.isMemberOfServer(userId, server._id.toString());
  }

  /**
   * Membership gate that also hands back the channel it matched, so a caller
   * can inspect `type` (voice vs text) without a second round trip.
   * `'channels.$'` projects only the array element that satisfied the filter.
   * Returns `null` for a malformed id, an unknown channel, or a non-member —
   * the caller never learns which.
   */
  async findChannelForMember(
    userId: string,
    channelId: string,
  ): Promise<Channel | null> {
    const channelObjectId = toObjectId(channelId);
    if (!channelObjectId) return null;

    const server = await this.serverModel
      .findOne({ 'channels._id': channelObjectId }, { _id: 1, 'channels.$': 1 })
      .exec();

    const channel = server?.channels?.[0];
    if (!server || !channel) return null;

    const isMember = await this.usersService.isMemberOfServer(
      userId,
      server._id.toString(),
    );

    return isMember ? channel : null;
  }
}
