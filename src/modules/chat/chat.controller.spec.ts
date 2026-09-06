import { Test, TestingModule } from '@nestjs/testing';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

describe('ChatController', () => {
  let controller: ChatController;
  let chatService: { findAllByChannel: jest.Mock };

  beforeEach(async () => {
    chatService = { findAllByChannel: jest.fn() };

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
});
