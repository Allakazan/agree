import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Server } from './schemas/server.schema';
import { Model } from 'mongoose';

@Injectable()
export class ServerService {
  constructor(@InjectModel(Server.name) private serverModel: Model<Server>) {}

  /*async create(createCatDto: CreateCatDto): Promise<Cat> {
    const createdCat = new this.catModel(createCatDto);
    return createdCat.save();
  }*/

  async findAll(): Promise<Server[]> {
    return this.serverModel.find().exec();
  }
}
