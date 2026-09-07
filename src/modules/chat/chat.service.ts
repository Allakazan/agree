import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { InferSelectModel, sql, eq, and, lt, desc } from 'drizzle-orm';
import { DRIZZLE } from 'src/drizzle/drizzle.module';
import { conversations, messages } from 'src/drizzle/schema';
import { DrizzleDB } from 'src/drizzle/types/drizzle';
import { ChatMessageDto, ListAllMessages } from './dto/chat.dto';
import { UsersService } from '../users/users.service';

export type CreatedMessage = {
  message: InferSelectModel<typeof messages>;
  // Participants of a dm/group, so the gateway can fan out to their user
  // rooms. Empty for channel messages — those are delivered by channel room.
  recipients: string[];
};

@Injectable()
export class ChatService {
  constructor(
    @Inject(DRIZZLE) private readonly drizzleService: DrizzleDB,
    private readonly usersService: UsersService,
  ) {}

  async createMessagesAndConversation(
    dto: ChatMessageDto,
    senderId: string,
    senderUsername: string,
  ): Promise<CreatedMessage> {
    const { id: conversationId, participants } = dto.channelId
      ? await this.findOrCreateChannelConversation(dto.channelId)
      : await this.findOrCreateDirectConversation(dto.recipientIds!, senderId);

    const message = await this.insertMessage(
      conversationId,
      senderId,
      senderUsername,
      dto.message,
    );

    return { message, recipients: participants };
  }

  // Caller-authorized: channel membership is enforced by ChatGateway, which
  // only lets a socket send to a channel room it has joined (and only lets it
  // join after ServerService.isUserMemberOfChannelServer passes). Any new
  // caller — REST, a queue consumer — must do that check itself first.
  private async findOrCreateChannelConversation(
    channelId: string,
  ): Promise<{ id: string; participants: string[] }> {
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

    return { id: upserted.id, participants: [] };
  }

  private async findOrCreateDirectConversation(
    recipientIds: string[],
    senderId: string,
  ): Promise<{ id: string; participants: string[] }> {
    const participantIds = Array.from(new Set([senderId, ...recipientIds]));

    const existingUsers = await this.usersService.findManyByIds(participantIds);
    if (existingUsers.length !== participantIds.length) {
      throw new BadRequestException('One or more participants do not exist');
    }

    const sortedParticipants = [...participantIds].sort();
    const dmKey = sortedParticipants.join(':');
    const type = sortedParticipants.length > 2 ? 'group' : 'dm';

    const [upserted] = await this.drizzleService
      .insert(conversations)
      .values({ type, participants: sortedParticipants, dmKey })
      .onConflictDoUpdate({
        target: conversations.dmKey,
        set: { dmKey: sql`excluded.dm_key` },
      })
      .returning({ id: conversations.id });

    return { id: upserted.id, participants: sortedParticipants };
  }

  private async insertMessage(
    conversationId: string,
    senderId: string,
    senderUsername: string,
    message: string,
  ): Promise<InferSelectModel<typeof messages>> {
    const [insertedMessage] = await this.drizzleService
      .insert(messages)
      .values({
        conversationId,
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
