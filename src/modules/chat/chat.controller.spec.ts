import { Test, TestingModule } from '@nestjs/testing';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

describe('ChatController', () => {
  let controller: ChatController;
  let chatService: {
    findAllByChannel: jest.Mock;
    findAllByConversation: jest.Mock;
    findConversationsForUser: jest.Mock;
  };
  const user = { sub: 'user-id', username: 'bruno' };

  beforeEach(async () => {
    chatService = {
      findAllByChannel: jest.fn(),
      findAllByConversation: jest.fn(),
      findConversationsForUser: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [{ provide: ChatService, useValue: chatService }],
    }).compile();

    controller = module.get<ChatController>(ChatController);
  });

  it('delegates to ChatService.findAllByChannel with the channel id and query', async () => {
    const messages = [{ id: 'message-id', content: 'hello' }];
    chatService.findAllByChannel.mockResolvedValue(messages);

    const result = await controller.find('channel-id', { limit: 20 });

    expect(chatService.findAllByChannel).toHaveBeenCalledWith('channel-id', {
      limit: 20,
    });
    expect(result).toBe(messages);
  });

  it('delegates to ChatService.findConversationsForUser with the caller id', async () => {
    const conversations = [{ id: 'convo-id', type: 'dm' }];
    chatService.findConversationsForUser.mockResolvedValue(conversations);

    const result = await controller.findConversations(user, { limit: 20 });

    expect(chatService.findConversationsForUser).toHaveBeenCalledWith(
      'user-id',
      { limit: 20 },
    );
    expect(result).toBe(conversations);
  });

  it('delegates to ChatService.findAllByConversation with the caller id', async () => {
    const messages = [{ id: 'message-id', content: 'hi' }];
    chatService.findAllByConversation.mockResolvedValue(messages);

    const result = await controller.findConversationMessages('convo-id', user, {
      limit: 20,
      before: '2025-08-10T18:00:00.000Z',
    });

    expect(chatService.findAllByConversation).toHaveBeenCalledWith(
      'convo-id',
      'user-id',
      { limit: 20, before: '2025-08-10T18:00:00.000Z' },
    );
    expect(result).toBe(messages);
  });
});
