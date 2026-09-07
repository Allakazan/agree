import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { LoggedUser } from 'src/modules/auth/types/loggedUser.type';
import { AuthGuard } from 'src/modules/auth/guards/auth.guard';
import { WsAuthService } from 'src/modules/auth/ws-auth.service';
import { ServerService } from '../server/server.service';
import { ChatMessageDto } from './dto/chat.dto';

describe('ChatGateway', () => {
  let gateway: ChatGateway;
  let chatService: { createMessagesAndConversation: jest.Mock };
  let serverService: { isUserMemberOfChannelServer: jest.Mock };
  let wsAuthService: { authenticate: jest.Mock };
  let emit: jest.Mock;
  let to: jest.Mock;
  let client: {
    rooms: Set<string>;
    join: jest.Mock;
    leave: jest.Mock;
    emit: jest.Mock;
    disconnect: jest.Mock;
    data: { user?: LoggedUser };
  };
  const user: LoggedUser = { sub: 'user-id', username: 'bruno' };

  const asSocket = () => client as never;

  beforeEach(async () => {
    chatService = { createMessagesAndConversation: jest.fn() };
    serverService = { isUserMemberOfChannelServer: jest.fn() };
    wsAuthService = { authenticate: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatGateway,
        { provide: ChatService, useValue: chatService },
        { provide: ServerService, useValue: serverService },
        { provide: WsAuthService, useValue: wsAuthService },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    gateway = module.get<ChatGateway>(ChatGateway);
    emit = jest.fn();
    to = jest.fn(() => ({ emit }));
    gateway.server = { to, emit } as never;
    client = {
      rooms: new Set<string>(),
      join: jest.fn((room: string) => {
        client.rooms.add(room);
        return Promise.resolve();
      }),
      leave: jest.fn((room: string) => {
        client.rooms.delete(room);
        return Promise.resolve();
      }),
      emit: jest.fn(),
      disconnect: jest.fn(),
      data: {},
    };
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('handleConnection', () => {
    it('attaches the user and joins its private room when the handshake is authenticated', async () => {
      wsAuthService.authenticate.mockResolvedValue(user);

      await gateway.handleConnection(asSocket());

      expect(client.data.user).toEqual(user);
      expect(client.join).toHaveBeenCalledWith('user:user-id');
      expect(client.disconnect).not.toHaveBeenCalled();
    });

    it('emits an error and disconnects an unauthenticated socket', async () => {
      wsAuthService.authenticate.mockResolvedValue(null);

      await gateway.handleConnection(asSocket());

      expect(client.emit).toHaveBeenCalledWith('error', {
        status: 'error',
        message: 'Unauthorized',
      });
      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(client.join).not.toHaveBeenCalled();
    });
  });

  describe('subscribe', () => {
    it('joins the channel room when the user is a member of the channel server', async () => {
      serverService.isUserMemberOfChannelServer.mockResolvedValue(true);

      const result = await gateway.handleSubscribe(
        { channelId: 'channel-id' },
        asSocket(),
        user,
      );

      expect(serverService.isUserMemberOfChannelServer).toHaveBeenCalledWith(
        'user-id',
        'channel-id',
      );
      expect(client.join).toHaveBeenCalledWith('channel:channel-id');
      expect(result).toEqual({ status: 'subscribed', channelId: 'channel-id' });
    });

    it('throws and does not join when the user is not a member', async () => {
      serverService.isUserMemberOfChannelServer.mockResolvedValue(false);

      await expect(
        gateway.handleSubscribe({ channelId: 'channel-id' }, asSocket(), user),
      ).rejects.toThrow(BadRequestException);
      expect(client.join).not.toHaveBeenCalled();
    });

    it('skips the membership lookup when the socket is already in the room', async () => {
      client.rooms.add('channel:channel-id');

      await gateway.handleSubscribe(
        { channelId: 'channel-id' },
        asSocket(),
        user,
      );

      expect(serverService.isUserMemberOfChannelServer).not.toHaveBeenCalled();
      expect(client.join).not.toHaveBeenCalled();
    });
  });

  describe('unsubscribe', () => {
    it('leaves the channel room', async () => {
      client.rooms.add('channel:channel-id');

      const result = await gateway.handleUnsubscribe(
        { channelId: 'channel-id' },
        asSocket(),
      );

      expect(client.leave).toHaveBeenCalledWith('channel:channel-id');
      expect(result).toEqual({
        status: 'unsubscribed',
        channelId: 'channel-id',
      });
    });
  });

  describe('chat', () => {
    it('persists a channel message and broadcasts the full row to the channel room', async () => {
      client.rooms.add('channel:channel-id');
      const createdAt = new Date('2025-08-10T18:00:00.000Z');
      const message = {
        id: 'message-id',
        conversationId: 'convo-id',
        content: 'hello',
        createdAt,
      };
      chatService.createMessagesAndConversation.mockResolvedValue({
        message,
        recipients: [],
      });
      const dto: ChatMessageDto = { message: 'hello', channelId: 'channel-id' };

      const result: unknown = await gateway.handleEvent(dto, asSocket(), user);

      expect(chatService.createMessagesAndConversation).toHaveBeenCalledWith(
        dto,
        'user-id',
        'bruno',
      );
      expect(to).toHaveBeenCalledWith('channel:channel-id');
      expect(emit).toHaveBeenCalledWith('channel:channel-id:messages', {
        id: 'message-id',
        conversationId: 'convo-id',
        content: 'hello',
        createdAt: createdAt.toISOString(),
      });
      expect(result).toEqual(message);
    });

    it('rejects a channel message from a socket that never subscribed', async () => {
      const dto: ChatMessageDto = { message: 'hello', channelId: 'channel-id' };

      await expect(gateway.handleEvent(dto, asSocket(), user)).rejects.toThrow(
        'Subscribe to this channel before sending messages',
      );
      expect(chatService.createMessagesAndConversation).not.toHaveBeenCalled();
      expect(client.join).not.toHaveBeenCalled();
      expect(to).not.toHaveBeenCalled();
    });

    it('persists a DM message and broadcasts to every participant user room', async () => {
      const createdAt = new Date('2025-08-10T18:00:00.000Z');
      const message = {
        id: 'message-id',
        conversationId: 'convo-id',
        content: 'hi',
        createdAt,
      };
      chatService.createMessagesAndConversation.mockResolvedValue({
        message,
        recipients: ['other-id', 'user-id'],
      });
      const dto: ChatMessageDto = {
        message: 'hi',
        recipientIds: ['other-id'],
      };

      const result: unknown = await gateway.handleEvent(dto, asSocket(), user);

      expect(to).toHaveBeenCalledWith(['user:other-id', 'user:user-id']);
      expect(emit).toHaveBeenCalledWith('conversation:convo-id:messages', {
        id: 'message-id',
        conversationId: 'convo-id',
        content: 'hi',
        createdAt: createdAt.toISOString(),
      });
      expect(result).toEqual(message);
    });

    it('throws a BadRequestException with the underlying error message on failure', async () => {
      client.rooms.add('channel:channel-id');
      chatService.createMessagesAndConversation.mockRejectedValue(
        new Error('db unavailable'),
      );
      const dto: ChatMessageDto = { message: 'hello', channelId: 'channel-id' };

      await expect(gateway.handleEvent(dto, asSocket(), user)).rejects.toThrow(
        BadRequestException,
      );
      await expect(gateway.handleEvent(dto, asSocket(), user)).rejects.toThrow(
        'db unavailable',
      );
      expect(emit).not.toHaveBeenCalled();
    });

    it('falls back to a generic message when the thrown value is not an Error', async () => {
      client.rooms.add('channel:channel-id');
      chatService.createMessagesAndConversation.mockRejectedValue('boom');
      const dto: ChatMessageDto = { message: 'hello', channelId: 'channel-id' };

      await expect(gateway.handleEvent(dto, asSocket(), user)).rejects.toThrow(
        'Error at the message socket',
      );
    });
  });
});
