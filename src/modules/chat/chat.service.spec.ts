import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ChatService } from './chat.service';
import { DRIZZLE } from 'src/drizzle/drizzle.module';
import { ChannelService } from '../channel/channel.service';
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
  let channelService: { isUserMemberOfChannelServer: jest.Mock };
  let usersService: { findManyByIds: jest.Mock };

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
    channelService = { isUserMemberOfChannelServer: jest.fn() };
    usersService = { findManyByIds: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: DRIZZLE, useValue: drizzle },
        { provide: ChannelService, useValue: channelService },
        { provide: UsersService, useValue: usersService },
      ],
    }).compile();

    service = module.get<ChatService>(ChatService);
  });

  describe('createMessagesAndConversation - channel path', () => {
    it('throws ForbiddenException and inserts nothing when the sender is not a member of the channel server', async () => {
      channelService.isUserMemberOfChannelServer.mockResolvedValue(false);
      const dto: ChatMessageDto = {
        message: 'hello',
        channelId: '507f1f77bcf86cd799439011',
      };

      await expect(
        service.createMessagesAndConversation(dto, 'user-id', 'bruno'),
      ).rejects.toThrow(ForbiddenException);
      expect(drizzle.insert).not.toHaveBeenCalled();
    });

    it('upserts the conversation and inserts the message when the sender is a member', async () => {
      channelService.isUserMemberOfChannelServer.mockResolvedValue(true);
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
      });
      expect(result).toEqual({
        id: 'message-id',
        conversationId: 'convo-id',
        senderId: 'user-id',
        content: 'hi',
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
