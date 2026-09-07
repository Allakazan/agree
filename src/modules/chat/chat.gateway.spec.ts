import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { DRIZZLE } from 'src/drizzle/drizzle.module';
import { LoggedUser } from 'src/modules/auth/types/loggedUser.type';
import { AuthGuard } from 'src/modules/auth/guards/auth.guard';
import { ChatMessageDto } from './dto/chat.dto';

describe('ChatGateway', () => {
  let gateway: ChatGateway;
  let chatService: { createMessagesAndConversation: jest.Mock };
  let emit: jest.Mock;
  const user: LoggedUser = { sub: 'user-id', username: 'bruno' };

  beforeEach(async () => {
    chatService = { createMessagesAndConversation: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatGateway,
        { provide: ChatService, useValue: chatService },
        { provide: DRIZZLE, useValue: {} },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    gateway = module.get<ChatGateway>(ChatGateway);
    emit = jest.fn();
    gateway.server = { emit } as never;
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('persists a channel message and broadcasts the full row to the channel room', async () => {
    const createdAt = new Date('2025-08-10T18:00:00.000Z');
    chatService.createMessagesAndConversation.mockResolvedValue({
      id: 'message-id',
      conversationId: 'convo-id',
      content: 'hello',
      createdAt,
    });
    const dto: ChatMessageDto = { message: 'hello', channelId: 'channel-id' };

    const result = await gateway.handleEvent(dto, user);

    expect(chatService.createMessagesAndConversation).toHaveBeenCalledWith(
      dto,
      'user-id',
      'bruno',
    );
    expect(emit).toHaveBeenCalledWith('channel:channel-id:messages', {
      id: 'message-id',
      conversationId: 'convo-id',
      content: 'hello',
      createdAt: createdAt.toISOString(),
    });
    expect(result).toEqual({
      id: 'message-id',
      conversationId: 'convo-id',
      content: 'hello',
      createdAt,
    });
  });

  it('persists a DM message and broadcasts the full row to the conversation room', async () => {
    const createdAt = new Date('2025-08-10T18:00:00.000Z');
    chatService.createMessagesAndConversation.mockResolvedValue({
      id: 'message-id',
      conversationId: 'convo-id',
      content: 'hi',
      createdAt,
    });
    const dto: ChatMessageDto = {
      message: 'hi',
      recipientIds: ['other-id'],
    };

    const result = await gateway.handleEvent(dto, user);

    expect(chatService.createMessagesAndConversation).toHaveBeenCalledWith(
      dto,
      'user-id',
      'bruno',
    );
    expect(emit).toHaveBeenCalledWith('conversation:convo-id:messages', {
      id: 'message-id',
      conversationId: 'convo-id',
      content: 'hi',
      createdAt: createdAt.toISOString(),
    });
    expect(result).toEqual({
      id: 'message-id',
      conversationId: 'convo-id',
      content: 'hi',
      createdAt,
    });
  });

  it('throws a BadRequestException with the underlying error message on failure', async () => {
    chatService.createMessagesAndConversation.mockRejectedValue(
      new Error('db unavailable'),
    );
    const dto: ChatMessageDto = { message: 'hello', channelId: 'channel-id' };

    await expect(gateway.handleEvent(dto, user)).rejects.toThrow(
      BadRequestException,
    );
    await expect(gateway.handleEvent(dto, user)).rejects.toThrow(
      'db unavailable',
    );
    expect(emit).not.toHaveBeenCalled();
  });

  it('falls back to a generic message when the thrown value is not an Error', async () => {
    chatService.createMessagesAndConversation.mockRejectedValue('boom');
    const dto: ChatMessageDto = { message: 'hello', channelId: 'channel-id' };

    await expect(gateway.handleEvent(dto, user)).rejects.toThrow(
      'Error at the message socket',
    );
  });
});
