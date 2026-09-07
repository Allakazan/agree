import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { Channel, ChannelSchema } from './channel.schema';

export type ServerDocument = HydratedDocument<Server>;

@Schema()
export class Server {
  @Prop()
  name: string;

  @Prop()
  description: string;

  @Prop()
  logoImg: string;

  @Prop()
  bannerImage: string;

  @Prop({ type: [ChannelSchema], default: [] })
  channels: Channel[];
}

export const ServerSchema = SchemaFactory.createForClass(Server);
ServerSchema.index({ 'channels._id': 1 });
