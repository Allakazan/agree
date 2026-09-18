import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ChannelDocument = HydratedDocument<Channel>;

export enum ChannelType {
  TEXT = 'text',
  VOICE = 'voice',
}

@Schema({ _id: true })
export class Channel {
  /** Assigned by Mongoose (`_id: true`); declared so callers can read it without a cast. */
  _id: Types.ObjectId;

  @Prop({ required: true })
  name: string;

  @Prop({ type: String, enum: ChannelType, required: true })
  type: ChannelType;
}

export const ChannelSchema = SchemaFactory.createForClass(Channel);
