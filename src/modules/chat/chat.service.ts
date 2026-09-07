import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { InferSelectModel, sql, eq, and, lt, desc } from 'drizzle-orm';
import { DRIZZLE } from 'src/drizzle/drizzle.module';
import { conversations, messages } from 'src/drizzle/schema';
import { DrizzleDB } from 'src/drizzle/types/drizzle';
import { ChatMessageDto, ListAllMessages } from './dto/chat.dto';
import { ChannelService } from '../channel/channel.service';
import { UsersService } from '../users/users.service';

@Injectable()
export class ChatService {
  constructor(
    @Inject(DRIZZLE) private readonly drizzleService: DrizzleDB,
    private readonly channelService: ChannelService,
    private readonly usersService: UsersService,
  ) {}

  async createMessagesAndConversation(
    dto: ChatMessageDto,
    senderId: string,
    senderUsername: string,
  ): Promise<InferSelectModel<typeof messages>> {
    const conversationId = dto.channelId
      ? await this.findOrCreateChannelConversation(dto.channelId, senderId)
      : await this.findOrCreateDirectConversation(dto.recipientIds!, senderId);

    return this.insertMessage(
      conversationId,
      senderId,
      senderUsername,
      dto.message,
    );
  }

  private async findOrCreateChannelConversation(
    channelId: string,
    senderId: string,
  ): Promise<string> {
    const isMember = await this.channelService.isUserMemberOfChannelServer(
      senderId,
      channelId,
    );
    if (!isMember) {
      throw new ForbiddenException(
        "You are not a member of this channel's server",
      );
    }

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

    return upserted.id;
  }

  private async findOrCreateDirectConversation(
    recipientIds: string[],
    senderId: string,
  ): Promise<string> {
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

    return upserted.id;
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
