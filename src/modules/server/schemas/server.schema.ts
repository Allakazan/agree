import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

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
}

export const ServerSchema = SchemaFactory.createForClass(Server);
