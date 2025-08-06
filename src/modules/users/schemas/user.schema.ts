import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type UserDocument = HydratedDocument<User>;

@Schema()
export class User {
  @Prop()
  username: string;

  @Prop()
  email: string;

  @Prop()
  password: string;

  @Prop()
  profileImageUrl: string;

  @Prop({ type: [{ type: MongooseSchema.Types.ObjectId, ref: 'Server' }] })
  serverIds: Types.ObjectId[];
}

export const UserSchema = SchemaFactory.createForClass(User);
