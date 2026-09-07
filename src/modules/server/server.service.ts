import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Server } from './schemas/server.schema';
import { Model } from 'mongoose';
import { CreateServerDto } from './dto/create-server.dto';
import { UsersService } from '../users/users.service';

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
}
