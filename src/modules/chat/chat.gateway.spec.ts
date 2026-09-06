import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { DRIZZLE } from 'src/drizzle/drizzle.module';
import { LoggedUser } from 'src/modules/auth/types/loggedUser.type';
import { AuthGuard } from 'src/modules/auth/guards/auth.guard';

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

  it('persists the message and broadcasts the full row to the channel room', async () => {
    const createdAt = new Date('2025-08-10T18:00:00.000Z');
    chatService.createMessagesAndConversation.mockResolvedValue({
      id: 'message-id',
      content: 'hello',
      createdAt,
    });

    const result = await gateway.handleEvent(
      { message: 'hello', channelId: 'channel-id' },
      user,
    );

    expect(chatService.createMessagesAndConversation).toHaveBeenCalledWith(
      'channel-id',
      'hello',
      'user-id',
      'bruno',
    );
    expect(emit).toHaveBeenCalledWith('channel:channel-id:messages', {
      id: 'message-id',
      content: 'hello',
      createdAt: createdAt.toISOString(),
    });
    expect(result).toEqual({
      id: 'message-id',
      content: 'hello',
      createdAt,
    });
  });

  it('throws a BadRequestException with the underlying error message on failure', async () => {
    chatService.createMessagesAndConversation.mockRejectedValue(
      new Error('db unavailable'),
    );

    await expect(
      gateway.handleEvent({ message: 'hello', channelId: 'channel-id' }, user),
    ).rejects.toThrow(BadRequestException);
    await expect(
      gateway.handleEvent({ message: 'hello', channelId: 'channel-id' }, user),
    ).rejects.toThrow('db unavailable');
    expect(emit).not.toHaveBeenCalled();
  });

  it('falls back to a generic message when the thrown value is not an Error', async () => {
    chatService.createMessagesAndConversation.mockRejectedValue('boom');

    await expect(
      gateway.handleEvent({ message: 'hello', channelId: 'channel-id' }, user),
    ).rejects.toThrow('Error at the message socket');
  });
});
