import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type ChannelDocument = HydratedDocument<Channel>;

@Schema()
export class Channel {
  @Prop({ required: true })
  name: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Server', required: true })
  serverId: Types.ObjectId;
}

export const ChannelSchema = SchemaFactory.createForClass(Channel);
ChannelSchema.index({ serverId: 1 });
