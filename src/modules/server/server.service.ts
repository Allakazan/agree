import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Server } from './schemas/server.schema';
import { Channel } from './schemas/channel.schema';
import { Document, Model } from 'mongoose';
import { CreateServerDto } from './dto/create-server.dto';
import { CreateChannelDto } from './dto/create-channel.dto';
import { User } from '../users/schemas/user.schema';
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
    const server = await new this.serverModel({
      ...createServerDto,
      ownerId: creatorId,
    }).save();
    await this.usersService.addServerId(creatorId, server._id.toString());
    return server;
  }

  /** Only the servers `userId` is a member of — never the full directory, or any signed-in user could browse (and, via the channel/voice routes, listen in on) servers they never joined. */
  async findAll(userId: string): Promise<Server[]> {
    const user = await this.usersService.findOne({ _id: userId });
    if (!user || user.serverIds.length === 0) return [];

    return this.serverModel.find({ _id: { $in: user.serverIds } }).exec();
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

  /**
   * Same membership gate as {@link findChannelForMember}, applied to the
   * whole channel list instead of one channel. A non-member gets the same
   * `NotFoundException` as an unknown server id — same reasoning as the WS
   * side (see `docs/voice-client.md`): a stranger shouldn't be able to tell
   * "doesn't exist" apart from "exists, you're just not in it".
   */
  async findChannelsByServer(
    serverId: string,
    userId: string,
  ): Promise<Channel[]> {
    const server = await this.serverModel
      .findById(serverId, { channels: 1 })
      .exec();

    if (!server) {
      throw new NotFoundException(`Server ${serverId} not found`);
    }

    const isMember = await this.usersService.isMemberOfServer(userId, serverId);
    if (!isMember) {
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

  /** Same membership gate as {@link findChannelsByServer} — any member can see the roster, not just the owner. */
  async findMembers(
    serverId: string,
    userId: string,
  ): Promise<(User & Document)[]> {
    await this.requireMember(serverId, userId);
    return this.usersService.findMembersOfServer(serverId);
  }

  /**
   * Adds `targetUserId` to the server — owner-only. Idempotent: adding an
   * existing member just no-ops (`addServerId` uses `$addToSet`). Throws
   * `NotFoundException` for an unknown server/target user (masking existence
   * from a non-owner the same way the rest of this service does) and
   * `ForbiddenException` when the caller isn't the owner.
   */
  async addMember(
    serverId: string,
    requesterId: string,
    targetUserId: string,
  ): Promise<void> {
    await this.requireOwner(serverId, requesterId);

    const target = await this.usersService.findOne({ _id: targetUserId });
    if (!target) throw new NotFoundException(`User ${targetUserId} not found`);

    await this.usersService.addServerId(targetUserId, serverId);
  }

  /**
   * Removes `targetUserId` from the server — owner-only. The owner can't
   * remove themselves this way (that would leave the server ownerless);
   * they'd need a "transfer ownership" or "delete server" flow, neither of
   * which exists yet.
   */
  async removeMember(
    serverId: string,
    requesterId: string,
    targetUserId: string,
  ): Promise<void> {
    const server = await this.requireOwner(serverId, requesterId);

    if (targetUserId === server.ownerId?.toString()) {
      throw new BadRequestException(
        'The server owner cannot be removed from their own server',
      );
    }

    await this.usersService.removeServerId(targetUserId, serverId);
  }

  /** Loads `serverId`, throwing `NotFoundException` if it doesn't exist or `userId` isn't a member — the shared gate behind {@link findChannelsByServer} and {@link findMembers}. */
  private async requireMember(
    serverId: string,
    userId: string,
  ): Promise<Server> {
    const server = await this.serverModel.findById(serverId).exec();
    if (!server) throw new NotFoundException(`Server ${serverId} not found`);

    const isMember = await this.usersService.isMemberOfServer(userId, serverId);
    if (!isMember) throw new NotFoundException(`Server ${serverId} not found`);

    return server;
  }

  /** Loads `serverId`, throwing `NotFoundException` if it doesn't exist and `ForbiddenException` if `userId` isn't its `ownerId` — the shared gate behind {@link addMember} and {@link removeMember}. */
  private async requireOwner(
    serverId: string,
    userId: string,
  ): Promise<Server> {
    const server = await this.serverModel.findById(serverId).exec();
    if (!server) throw new NotFoundException(`Server ${serverId} not found`);

    if (!server.ownerId || server.ownerId.toString() !== userId) {
      throw new ForbiddenException('Only the server owner can manage members');
    }

    return server;
  }
}
