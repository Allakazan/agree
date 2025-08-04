import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  varchar,
  index,
  unique,
} from 'drizzle-orm/pg-core';

export const conversationTypeEnum = pgEnum('conversation_type', [
  'channel',
  'dm',
  'group',
]);

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    type: conversationTypeEnum('type').notNull(),
    participants: varchar('participants').array(),
    relatedMongoChannelId: varchar('related_mongo_channel_id', { length: 36 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    unique('unique_mongo_channel_id').on(table.relatedMongoChannelId),
  ],
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id),
    senderId: varchar('sender_id').notNull(),
    senderUsername: varchar('sender_username').notNull(),
    senderAvatarUrl: varchar('sender_avatar_url').notNull(),
    content: text('content').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('messages_convo_created_at_idx').on(
      table.conversationId,
      table.createdAt,
    ),
  ],
);
