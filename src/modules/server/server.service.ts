import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Server } from './schemas/server.schema';
import { Model } from 'mongoose';
import { CreateServerDto } from './dto/create-server.dto';

@Injectable()
export class ServerService {
  constructor(@InjectModel(Server.name) private serverModel: Model<Server>) {}

  async create(createServerDto: CreateServerDto): Promise<Server> {
    return (new this.serverModel(createServerDto)).save();
  }

  async findAll(): Promise<Server[]> {
    return this.serverModel.find().exec();
  }
}
