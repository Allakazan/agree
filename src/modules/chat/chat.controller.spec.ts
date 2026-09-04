import { Test, TestingModule } from '@nestjs/testing';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

describe('ChatController', () => {
  let controller: ChatController;
  let chatService: { findAll: jest.Mock };

  beforeEach(async () => {
    chatService = { findAll: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [{ provide: ChatService, useValue: chatService }],
    }).compile();

    controller = module.get<ChatController>(ChatController);
  });

  it('delegates to ChatService.findAll with the conversation id and query', async () => {
    const messages = [{ id: 'message-id', content: 'hello' }];
    chatService.findAll.mockResolvedValue(messages);

    const result = await controller.find('convo-id', { limit: 20 });

    expect(chatService.findAll).toHaveBeenCalledWith('convo-id', {
      limit: 20,
    });
    expect(result).toBe(messages);
  });
});
