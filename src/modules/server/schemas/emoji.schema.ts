import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';

/** Allowed emoji names: what a client types between colons (`:pepe:`). */
export const EMOJI_NAME_PATTERN = /^[a-z0-9_]{2,32}$/;

/**
 * A server's custom emoji — a name and the image it stands for. The image is
 * only ever a URL: the backend stores no bytes and never fetches it, so a
 * broken link renders as the literal `:name:` on the client, nothing more.
 * Embedded in `Server.emojis` like channels are, since it is read together
 * with the server and never on its own.
 */
@Schema({ _id: true })
export class CustomEmoji {
  /** Assigned by Mongoose (`_id: true`); declared so callers can read it without a cast. */
  _id: Types.ObjectId;

  /** Unique within the server; lowercased so `:Pepe:` and `:pepe:` can't coexist. */
  @Prop({ required: true, lowercase: true, trim: true })
  name: string;

  @Prop({ required: true })
  url: string;

  /** Any member may add one; only this user or the server owner may remove it. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  createdBy: Types.ObjectId;
}

export const CustomEmojiSchema = SchemaFactory.createForClass(CustomEmoji);
