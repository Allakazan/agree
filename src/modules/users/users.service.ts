import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { User } from './schemas/user.schema';
import { Model, Document, FilterQuery } from 'mongoose';

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private userModel: Model<User>) {}

  async findOne(filter: FilterQuery<User>): Promise<(User & Document) | null> {
    return this.userModel.findOne(filter).exec();
  }

  async addServerId(userId: string, serverId: string): Promise<void> {
    await this.userModel
      .updateOne({ _id: userId }, { $addToSet: { serverIds: serverId } })
      .exec();
  }

  async isMemberOfServer(userId: string, serverId: string): Promise<boolean> {
    return (
      (await this.userModel.exists({ _id: userId, serverIds: serverId })) !==
      null
    );
  }

  async findManyByIds(ids: string[]): Promise<(User & Document)[]> {
    return this.userModel.find({ _id: { $in: ids } }).exec();
  }

  // Backs `GET /users` — the picker a client uses to start a DM.
  async findAllExcept(userId: string): Promise<(User & Document)[]> {
    return this.userModel.find({ _id: { $ne: userId } }).exec();
  }
}
