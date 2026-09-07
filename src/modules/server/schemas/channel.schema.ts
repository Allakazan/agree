import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ChannelDocument = HydratedDocument<Channel>;

export enum ChannelType {
  TEXT = 'text',
  VOICE = 'voice',
}

@Schema({ _id: true })
export class Channel {
  @Prop({ required: true })
  name: string;

  @Prop({ type: String, enum: ChannelType, required: true })
  type: ChannelType;
}

export const ChannelSchema = SchemaFactory.createForClass(Channel);
