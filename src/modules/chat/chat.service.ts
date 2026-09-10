import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
    // One timestamp for both writes: the conversation upsert stamps
    // lastMessageAt with it and the message row uses it as createdAt, so the
    // denormalized column can never drift from the newest message.
    const sentAt = new Date(); // Force UTC time

    // The JWT only carries sub/username and is never reissued when a picture
    // changes, so the avatar is read fresh from Mongo — alongside the upsert,
    // so it adds no latency to the send.
    const [{ id: conversationId, participants }, sender] = await Promise.all([
      dto.channelId
        ? this.findOrCreateChannelConversation(dto.channelId, sentAt)
        : this.findOrCreateDirectConversation(
            dto.recipientIds!,
            senderId,
            sentAt,
          ),
      this.usersService.findOne({ _id: senderId }),
    ]);

    const message = await this.insertMessage(
      conversationId,
      senderId,
      senderUsername,
      // A snapshot, like senderUsername: '' means "no picture", which the
      // client renders as initials.
      sender?.profileImageUrl || '',
      dto.message,
      sentAt,
    );

    return { message, recipients: participants };
  }

  // Caller-authorized: channel membership is enforced by ChatGateway, which
  // only lets a socket send to a channel room it has joined (and only lets it
  // join after ServerService.isUserMemberOfChannelServer passes). Any new
  // caller — REST, a queue consumer — must do that check itself first.
  private async findOrCreateChannelConversation(
    channelId: string,
    sentAt: Date,
  ): Promise<{ id: string; participants: string[] }> {
    const [upserted] = await this.drizzleService
      .insert(conversations)
      .values({
        type: 'channel',
        relatedMongoChannelId: channelId,
        lastMessageAt: sentAt,
      })
      // Bumping lastMessageAt doubles as the update that forces the RETURNING.
      .onConflictDoUpdate({
        target: conversations.relatedMongoChannelId,
        set: { lastMessageAt: sentAt },
      })
      .returning({ id: conversations.id });

    return { id: upserted.id, participants: [] };
  }

  private async findOrCreateDirectConversation(
    recipientIds: string[],
    senderId: string,
    sentAt: Date,
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
      .values({
        type,
        participants: sortedParticipants,
        dmKey,
        lastMessageAt: sentAt,
      })
      .onConflictDoUpdate({
        target: conversations.dmKey,
        set: { lastMessageAt: sentAt },
      })
      .returning({ id: conversations.id });

    return { id: upserted.id, participants: sortedParticipants };
  }

  private async insertMessage(
    conversationId: string,
    senderId: string,
    senderUsername: string,
    senderAvatarUrl: string,
    message: string,
    sentAt: Date,
  ): Promise<InferSelectModel<typeof messages>> {
    const [insertedMessage] = await this.drizzleService
      .insert(messages)
      .values({
        conversationId,
        senderId,
        senderUsername,
        senderAvatarUrl,
        content: message,
        createdAt: sentAt,
      })
      .returning();

    return insertedMessage;
  }

  // Conversation ids only ever reach a client over the socket, so without this
  // route a page refresh loses every DM. Ordered by the denormalized
  // lastMessageAt, and paginated on the same column.
  async findConversationsForUser(
    userId: string,
    { limit, before }: ListAllMessages,
  ) {
    const rows = await this.drizzleService
      .select({
        id: conversations.id,
        type: conversations.type,
        participantIds: conversations.participants,
        createdAt: conversations.createdAt,
        lastMessageAt: conversations.lastMessageAt,
      })
      .from(conversations)
      .where(
        and(
          sql`${conversations.participants} @> ARRAY[${userId}]::varchar[]`,
          before
            ? lt(conversations.lastMessageAt, new Date(before))
            : undefined,
        ),
      )
      .orderBy(desc(conversations.lastMessageAt))
      .limit(limit);

    return this.hydrateParticipants(rows);
  }

  // The dm/group counterpart of findAllByChannel. Channel conversations have a
  // null participants list, so they can never be read through this path — they
  // go through findAllByChannel instead.
  async findAllByConversation(
    conversationId: string,
    userId: string,
    params: ListAllMessages,
  ) {
    const [conversation] = await this.drizzleService
      .select({
        id: conversations.id,
        participants: conversations.participants,
      })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1);

    if (!conversation) {
      throw new NotFoundException(`Conversation ${conversationId} not found`);
    }

    if (!conversation.participants?.includes(userId)) {
      throw new ForbiddenException(
        'You are not a participant of this conversation',
      );
    }

    return this.findAll(conversationId, params);
  }

  // `participants` is a bare array of Mongo user id strings — no FK, different
  // database — so display data has to come from Mongo in a second lookup.
  // Without it a DM list is just opaque ids, and there is no user endpoint for
  // a client to resolve them itself.
  private async hydrateParticipants<
    T extends { participantIds: string[] | null; lastMessageAt: Date | null },
  >(rows: T[]) {
    const ids = [...new Set(rows.flatMap((row) => row.participantIds ?? []))];
    const users = await this.usersService.findManyByIds(ids);
    const byId = new Map(
      users.map((user) => [
        String(user._id),
        {
          id: String(user._id),
          username: user.username,
          profileImageUrl: user.profileImageUrl,
        },
      ]),
    );

    return rows.map(({ participantIds, ...row }) => ({
      ...row,
      lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
      participants: (participantIds ?? []).map(
        (id) => byId.get(id) ?? { id, username: null, profileImageUrl: null },
      ),
    }));
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
