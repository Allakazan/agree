import { Inject, Injectable } from '@nestjs/common';
import { InferSelectModel, sql, eq, and, lt, desc } from 'drizzle-orm';
import { DRIZZLE } from 'src/drizzle/drizzle.module';
import { conversations, messages } from 'src/drizzle/schema';
import { DrizzleDB } from 'src/drizzle/types/drizzle';
import { ListAllMessages } from './dto/chat.dto';

@Injectable()
export class ChatService {
  constructor(@Inject(DRIZZLE) private readonly drizzleService: DrizzleDB) {}

  async createMessagesAndConversation(
    channelId: string,
    message: string,
    senderId: string,
    senderUsername: string,
  ): Promise<InferSelectModel<typeof messages>> {
    const [upserted] = await this.drizzleService
      .insert(conversations)
      .values({ type: 'channel', relatedMongoChannelId: channelId })
      .onConflictDoUpdate({
        target: conversations.relatedMongoChannelId,
        set: {
          // Set "falso", só pra forçar o RETURNING
          relatedMongoChannelId: sql`excluded.related_mongo_channel_id`,
        },
      })
      .returning({ id: conversations.id });

    const [insertedMessage] = await this.drizzleService
      .insert(messages)
      .values({
        conversationId: upserted.id,
        senderId,
        senderUsername,
        senderAvatarUrl: '',
        content: message,
        createdAt: new Date(), // Force UTC time
      })
      .returning();

    return insertedMessage;
  }

  // Client only ever knows the Mongo channelId (relatedMongoChannelId) —
  // resolve it to the internal conversation before reading messages.
  async findAllByChannel(channelId: string, params: ListAllMessages) {
    const [conversation] = await this.drizzleService
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.relatedMongoChannelId, channelId))
      .limit(1);

    if (!conversation) return [];

    return this.findAll(conversation.id, params);
  }

  async findAll(conversationId: string, { limit, before }: ListAllMessages) {
    const rows = await this.drizzleService
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversationId),
          before ? lt(messages.createdAt, new Date(before)) : undefined,
        ),
      )
      .orderBy(desc(messages.createdAt))
      .limit(limit);

    return rows.map((msg) => ({
      ...msg,
      createdAt: msg.createdAt!.toISOString(),
    }));
  }
}
