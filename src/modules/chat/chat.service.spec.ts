import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ChatService } from './chat.service';
import { DRIZZLE } from 'src/drizzle/drizzle.module';
import { UsersService } from '../users/users.service';
import { ChatMessageDto } from './dto/chat.dto';

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
  let usersService: { findManyByIds: jest.Mock; findOne: jest.Mock };

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
    usersService = {
      findManyByIds: jest.fn(),
      findOne: jest.fn().mockResolvedValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: DRIZZLE, useValue: drizzle },
        { provide: UsersService, useValue: usersService },
      ],
    }).compile();

    service = module.get<ChatService>(ChatService);
  });

  // Channel membership is enforced by ChatGateway (room membership), not here
  // — see the note on findOrCreateChannelConversation.
  describe('createMessagesAndConversation - channel path', () => {
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
      const dto: ChatMessageDto = {
        message: 'hello',
        channelId: '507f1f77bcf86cd799439011',
      };

      const result = await service.createMessagesAndConversation(
        dto,
        'user-id',
        'bruno',
      );

      expect(drizzle.insert).toHaveBeenCalledTimes(2);
      expect(drizzle.values).toHaveBeenNthCalledWith(1, {
        type: 'channel',
        relatedMongoChannelId: '507f1f77bcf86cd799439011',
        lastMessageAt: expect.any(Date) as Date,
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
        message: {
          id: 'message-id',
          conversationId: 'convo-id',
          senderId: 'user-id',
          content: 'hello',
        },
        // Channel messages fan out by channel room, so there is no
        // participant list to deliver to.
        recipients: [],
      });
    });
  });

  it('stamps the conversation lastMessageAt with the exact message createdAt', async () => {
    drizzle.returning
      .mockResolvedValueOnce([{ id: 'convo-id' }])
      .mockResolvedValueOnce([{ id: 'message-id' }]);

    await service.createMessagesAndConversation(
      { message: 'hello', channelId: '507f1f77bcf86cd799439011' },
      'user-id',
      'bruno',
    );

    const [conversationValues] = drizzle.values.mock.calls[0] as unknown as [
      { lastMessageAt: Date },
    ];
    const [messageValues] = drizzle.values.mock.calls[1] as unknown as [
      { createdAt: Date },
    ];

    // The denormalized column must never drift from the newest message.
    expect(conversationValues.lastMessageAt).toBe(messageValues.createdAt);
  });

  describe('createMessagesAndConversation - sender avatar', () => {
    beforeEach(() => {
      drizzle.returning
        .mockResolvedValueOnce([{ id: 'convo-id' }])
        .mockResolvedValueOnce([{ id: 'message-id' }]);
    });

    it("stores the sender's current profileImageUrl from Mongo", async () => {
      usersService.findOne.mockResolvedValue({
        _id: 'user-id',
        profileImageUrl: 'https://example.com/bruno.png',
      });

      await service.createMessagesAndConversation(
        { message: 'hello', channelId: '507f1f77bcf86cd799439011' },
        'user-id',
        'bruno',
      );

      expect(usersService.findOne).toHaveBeenCalledWith({ _id: 'user-id' });
      expect(drizzle.values).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          senderAvatarUrl: 'https://example.com/bruno.png',
        }),
      );
    });

    it.each([
      ['has no profileImageUrl', { _id: 'user-id', profileImageUrl: '' }],
      ['no longer exists', null],
    ])("stores '' when the sender %s", async (_, sender) => {
      usersService.findOne.mockResolvedValue(sender);

      await service.createMessagesAndConversation(
        { message: 'hello', channelId: '507f1f77bcf86cd799439011' },
        'user-id',
        'bruno',
      );

      expect(drizzle.values).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ senderAvatarUrl: '' }),
      );
    });
  });

  describe('createMessagesAndConversation - DM path', () => {
    it('throws BadRequestException when a participant does not exist', async () => {
      usersService.findManyByIds.mockResolvedValue([{ id: 'user-id' }]);
      const dto: ChatMessageDto = {
        message: 'hello',
        recipientIds: ['507f1f77bcf86cd799439012'],
      };

      await expect(
        service.createMessagesAndConversation(dto, 'user-id', 'bruno'),
      ).rejects.toThrow(BadRequestException);
      expect(drizzle.insert).not.toHaveBeenCalled();
    });

    it('creates a dm conversation for two participants', async () => {
      usersService.findManyByIds.mockResolvedValue([
        { id: 'user-id' },
        { id: 'other-id' },
      ]);
      drizzle.returning
        .mockResolvedValueOnce([{ id: 'convo-id' }])
        .mockResolvedValueOnce([
          {
            id: 'message-id',
            conversationId: 'convo-id',
            senderId: 'user-id',
            content: 'hi',
          },
        ]);
      const dto: ChatMessageDto = {
        message: 'hi',
        recipientIds: ['other-id'],
      };

      const result = await service.createMessagesAndConversation(
        dto,
        'user-id',
        'bruno',
      );

      expect(drizzle.values).toHaveBeenNthCalledWith(1, {
        type: 'dm',
        participants: ['other-id', 'user-id'],
        dmKey: 'other-id:user-id',
        lastMessageAt: expect.any(Date) as Date,
      });
      expect(result).toEqual({
        message: {
          id: 'message-id',
          conversationId: 'convo-id',
          senderId: 'user-id',
          content: 'hi',
        },
        // Sorted, and always including the sender — the gateway maps these
        // straight onto `user:<id>` rooms.
        recipients: ['other-id', 'user-id'],
      });
    });

    it('creates a group conversation for three or more participants', async () => {
      usersService.findManyByIds.mockResolvedValue([
        { id: 'user-id' },
        { id: 'b-id' },
        { id: 'c-id' },
      ]);
      drizzle.returning
        .mockResolvedValueOnce([{ id: 'convo-id' }])
        .mockResolvedValueOnce([{ id: 'message-id' }]);
      const dto: ChatMessageDto = {
        message: 'hi all',
        recipientIds: ['b-id', 'c-id'],
      };

      await service.createMessagesAndConversation(dto, 'user-id', 'bruno');

      expect(drizzle.values).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ type: 'group' }),
      );
    });

    it('produces the same dmKey regardless of recipientIds order', async () => {
      usersService.findManyByIds.mockResolvedValue([
        { id: 'user-id' },
        { id: 'other-id' },
      ]);
      drizzle.returning
        .mockResolvedValue([{ id: 'convo-id' }])
        .mockResolvedValueOnce([{ id: 'convo-id' }])
        .mockResolvedValueOnce([{ id: 'message-id' }])
        .mockResolvedValueOnce([{ id: 'convo-id' }])
        .mockResolvedValueOnce([{ id: 'message-id' }]);

      await service.createMessagesAndConversation(
        { message: 'hi', recipientIds: ['other-id'] },
        'user-id',
        'bruno',
      );
      const firstCallArgs = drizzle.values.mock.calls[0] as unknown as [
        { dmKey: string },
      ];
      const firstDmKey = firstCallArgs[0].dmKey;

      drizzle.values.mockClear();

      await service.createMessagesAndConversation(
        { message: 'hi', recipientIds: ['user-id'] },
        'other-id',
        'other-username',
      );
      const secondCallArgs = drizzle.values.mock.calls[0] as unknown as [
        { dmKey: string },
      ];
      const secondDmKey = secondCallArgs[0].dmKey;

      expect(firstDmKey).toBe(secondDmKey);
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

  describe('findConversationsForUser', () => {
    it('returns the caller conversations with participants hydrated from Mongo', async () => {
      const lastMessageAt = new Date('2025-08-10T18:00:00.000Z');
      drizzle.limit.mockResolvedValue([
        {
          id: 'convo-id',
          type: 'dm',
          participantIds: ['other-id', 'user-id'],
          createdAt: lastMessageAt,
          lastMessageAt,
        },
      ]);
      usersService.findManyByIds.mockResolvedValue([
        { _id: 'other-id', username: 'other', profileImageUrl: 'other.png' },
        { _id: 'user-id', username: 'bruno', profileImageUrl: 'bruno.png' },
      ]);

      const result = await service.findConversationsForUser('user-id', {
        limit: 20,
      });

      expect(usersService.findManyByIds).toHaveBeenCalledWith([
        'other-id',
        'user-id',
      ]);
      expect(drizzle.limit).toHaveBeenCalledWith(20);
      expect(result).toEqual([
        {
          id: 'convo-id',
          type: 'dm',
          createdAt: lastMessageAt,
          lastMessageAt: lastMessageAt.toISOString(),
          participants: [
            { id: 'other-id', username: 'other', profileImageUrl: 'other.png' },
            { id: 'user-id', username: 'bruno', profileImageUrl: 'bruno.png' },
          ],
        },
      ]);
    });

    it('falls back to a null-named participant when the user no longer exists', async () => {
      drizzle.limit.mockResolvedValue([
        {
          id: 'convo-id',
          type: 'dm',
          participantIds: ['deleted-id'],
          createdAt: new Date('2025-08-10T18:00:00.000Z'),
          lastMessageAt: null,
        },
      ]);
      usersService.findManyByIds.mockResolvedValue([]);

      const [conversation] = await service.findConversationsForUser('user-id', {
        limit: 20,
      });

      expect(conversation.lastMessageAt).toBeNull();
      expect(conversation.participants).toEqual([
        { id: 'deleted-id', username: null, profileImageUrl: null },
      ]);
    });
  });

  describe('findAllByConversation', () => {
    it('throws NotFoundException when the conversation does not exist', async () => {
      drizzle.limit.mockResolvedValueOnce([]);

      await expect(
        service.findAllByConversation('convo-id', 'user-id', { limit: 20 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when the caller is not a participant', async () => {
      drizzle.limit.mockResolvedValueOnce([
        { id: 'convo-id', participants: ['other-id'] },
      ]);

      await expect(
        service.findAllByConversation('convo-id', 'user-id', { limit: 20 }),
      ).rejects.toThrow(ForbiddenException);
    });

    // Channel rows have a null participants list, so this route can never be
    // used to read a channel's history.
    it('throws ForbiddenException for a channel conversation', async () => {
      drizzle.limit.mockResolvedValueOnce([
        { id: 'convo-id', participants: null },
      ]);

      await expect(
        service.findAllByConversation('convo-id', 'user-id', { limit: 20 }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('returns the messages when the caller is a participant', async () => {
      const createdAt = new Date('2025-08-10T18:00:00.000Z');
      drizzle.limit
        .mockResolvedValueOnce([
          { id: 'convo-id', participants: ['other-id', 'user-id'] },
        ])
        .mockResolvedValueOnce([
          { id: 'message-id', conversationId: 'convo-id', createdAt },
        ]);

      const result = await service.findAllByConversation(
        'convo-id',
        'user-id',
        { limit: 20 },
      );

      expect(result).toEqual([
        {
          id: 'message-id',
          conversationId: 'convo-id',
          createdAt: createdAt.toISOString(),
        },
      ]);
    });
  });

  describe('findAllByChannel', () => {
    it('resolves the conversation by channelId then delegates to findAll', async () => {
      const createdAt = new Date('2025-08-10T18:00:00.000Z');
      drizzle.limit
        .mockResolvedValueOnce([{ id: 'convo-id' }])
        .mockResolvedValueOnce([
          { id: 'message-id', conversationId: 'convo-id', createdAt },
        ]);

      const result = await service.findAllByChannel('channel-id', {
        limit: 20,
      });

      expect(result).toEqual([
        {
          id: 'message-id',
          conversationId: 'convo-id',
          createdAt: createdAt.toISOString(),
        },
      ]);
    });

    it('returns an empty array when the channel has no conversation yet', async () => {
      drizzle.limit.mockResolvedValueOnce([]);

      const result = await service.findAllByChannel('channel-id', {
        limit: 20,
      });

      expect(result).toEqual([]);
    });
  });
});
