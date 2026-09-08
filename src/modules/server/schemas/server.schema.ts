import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
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

  /**
   * The user who created the server — the only one allowed to add/remove
   * members (`ServerService.addMember`/`removeMember`). Optional because
   * servers seeded before this field existed have none; treat a missing
   * `ownerId` as "no one can manage members" rather than defaulting it to
   * anyone.
   */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  ownerId?: Types.ObjectId;
}

export const ServerSchema = SchemaFactory.createForClass(Server);
ServerSchema.index({ 'channels._id': 1 });
