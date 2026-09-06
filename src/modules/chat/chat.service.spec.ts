import { Test, TestingModule } from '@nestjs/testing';
import { ChatService } from './chat.service';
import { DRIZZLE } from 'src/drizzle/drizzle.module';

describe('ChatService', () => {
  let service: ChatService;
  let drizzle: {
    insert: jest.Mock;
    values: jest.Mock;
    onConflictDoUpdate: jest.Mock;
    returning: jest.Mock;
    select: jest.Mock;
    from: jest.Mock;
    where: jest.Mock;
    orderBy: jest.Mock;
    limit: jest.Mock;
  };

  beforeEach(async () => {
    drizzle = {
      insert: jest.fn(function (this: unknown) {
        return this;
      }),
      values: jest.fn(function (this: unknown) {
        return this;
      }),
      onConflictDoUpdate: jest.fn(function (this: unknown) {
        return this;
      }),
      returning: jest.fn(),
      select: jest.fn(function (this: unknown) {
        return this;
      }),
      from: jest.fn(function (this: unknown) {
        return this;
      }),
      where: jest.fn(function (this: unknown) {
        return this;
      }),
      orderBy: jest.fn(function (this: unknown) {
        return this;
      }),
      limit: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [ChatService, { provide: DRIZZLE, useValue: drizzle }],
    }).compile();

    service = module.get<ChatService>(ChatService);
  });

  describe('createMessagesAndConversation', () => {
    it('upserts the conversation and inserts the message', async () => {
      drizzle.returning
        .mockResolvedValueOnce([{ id: 'convo-id' }])
        .mockResolvedValueOnce([
          {
            id: 'message-id',
            conversationId: 'convo-id',
            senderId: 'user-id',
            content: 'hello',
          },
        ]);

      const result = await service.createMessagesAndConversation(
        'channel-id',
        'hello',
        'user-id',
        'bruno',
      );

      expect(drizzle.insert).toHaveBeenCalledTimes(2);
      expect(drizzle.values).toHaveBeenNthCalledWith(1, {
        type: 'channel',
        relatedMongoChannelId: 'channel-id',
      });
      expect(drizzle.values).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          conversationId: 'convo-id',
          senderId: 'user-id',
          senderUsername: 'bruno',
          content: 'hello',
        }),
      );
      expect(result).toEqual({
        id: 'message-id',
        conversationId: 'convo-id',
        senderId: 'user-id',
        content: 'hello',
      });
    });
  });

  describe('findAll', () => {
    it('returns messages for a conversation with createdAt serialized to ISO string', async () => {
      const createdAt = new Date('2025-08-10T18:00:00.000Z');
      drizzle.limit.mockResolvedValue([
        { id: 'message-id', conversationId: 'convo-id', createdAt },
      ]);

      const result = await service.findAll('convo-id', { limit: 20 });

      expect(drizzle.orderBy).toHaveBeenCalled();
      expect(drizzle.limit).toHaveBeenCalledWith(20);
      expect(result).toEqual([
        {
          id: 'message-id',
          conversationId: 'convo-id',
          createdAt: createdAt.toISOString(),
        },
      ]);
    });

    it('passes the before filter through to the where clause', async () => {
      drizzle.limit.mockResolvedValue([]);

      await service.findAll('convo-id', {
        limit: 20,
        before: '2025-08-10T18:00:00.000Z',
      });

      expect(drizzle.where).toHaveBeenCalled();
    });
  });
});
