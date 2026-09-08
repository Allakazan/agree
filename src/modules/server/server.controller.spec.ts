import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ServerController } from './server.controller';
import { ServerService } from './server.service';
import { CreateServerDto } from './dto/create-server.dto';
import { CreateChannelDto } from './dto/create-channel.dto';
import { ChannelType } from './schemas/channel.schema';
import { LoggedUser } from '../auth/types/loggedUser.type';

describe('ServerController', () => {
  let controller: ServerController;
  let serverService: {
    create: jest.Mock;
    findAll: jest.Mock;
    createChannel: jest.Mock;
    findChannelsByServer: jest.Mock;
    findMembers: jest.Mock;
    addMember: jest.Mock;
    removeMember: jest.Mock;
  };
  const user: LoggedUser = { sub: 'user-id', username: 'bruno' };
  const dto: CreateServerDto = {
    name: 'My Server',
    description: 'A server',
    logoImg: 'logo.png',
    bannerImage: 'banner.png',
  };

  beforeEach(async () => {
    serverService = {
      create: jest.fn(),
      findAll: jest.fn(),
      createChannel: jest.fn(),
      findChannelsByServer: jest.fn(),
      findMembers: jest.fn(),
      addMember: jest.fn(),
      removeMember: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ServerController],
      providers: [{ provide: ServerService, useValue: serverService }],
    }).compile();

    controller = module.get<ServerController>(ServerController);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('create', () => {
    it('delegates to ServerService.create and returns the result', async () => {
      const created = { ...dto, id: 'server-id' };
      serverService.create.mockResolvedValue(created);

      const result = await controller.create(user, dto);

      expect(serverService.create).toHaveBeenCalledWith(dto, user.sub);
      expect(result).toBe(created);
    });

    it('wraps ServerService.create errors in a BadRequestException', async () => {
      serverService.create.mockRejectedValue(new Error('save failed'));

      await expect(controller.create(user, dto)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('find', () => {
    it("returns the caller's servers from ServerService.findAll", async () => {
      const servers = [{ id: '1', name: 'A' }];
      serverService.findAll.mockResolvedValue(servers);

      const result = await controller.find(user);

      expect(serverService.findAll).toHaveBeenCalledWith(user.sub);
      expect(result).toBe(servers);
    });
  });

  describe('createChannel', () => {
    it('delegates to ServerService.createChannel and returns the result', async () => {
      const channelDto: CreateChannelDto = {
        name: 'general',
        type: ChannelType.TEXT,
      };
      const created = { _id: 'channel-id', ...channelDto };
      serverService.createChannel.mockResolvedValue(created);

      const result = await controller.createChannel('server-id', channelDto);

      expect(serverService.createChannel).toHaveBeenCalledWith(
        'server-id',
        channelDto,
      );
      expect(result).toBe(created);
    });
  });

  describe('findChannels', () => {
    it('returns channels from ServerService.findChannelsByServer', async () => {
      const channels = [{ _id: 'channel-id', name: 'general', type: 'text' }];
      serverService.findChannelsByServer.mockResolvedValue(channels);

      const result = await controller.findChannels('server-id', user);

      expect(serverService.findChannelsByServer).toHaveBeenCalledWith(
        'server-id',
        user.sub,
      );
      expect(result).toBe(channels);
    });
  });

  describe('findMembers', () => {
    it('maps ServerService.findMembers to public fields', async () => {
      serverService.findMembers.mockResolvedValue([
        { _id: 'a', username: 'ana', profileImageUrl: 'a.png' },
        { _id: 'b', username: 'bruno', profileImageUrl: null },
      ]);

      const result = await controller.findMembers('server-id', user);

      expect(serverService.findMembers).toHaveBeenCalledWith(
        'server-id',
        user.sub,
      );
      expect(result).toEqual([
        { id: 'a', username: 'ana', profileImageUrl: 'a.png' },
        { id: 'b', username: 'bruno', profileImageUrl: null },
      ]);
    });
  });

  describe('addMember', () => {
    it('delegates to ServerService.addMember', async () => {
      await controller.addMember('server-id', { userId: 'target-id' }, user);

      expect(serverService.addMember).toHaveBeenCalledWith(
        'server-id',
        user.sub,
        'target-id',
      );
    });
  });

  describe('removeMember', () => {
    it('delegates to ServerService.removeMember', async () => {
      await controller.removeMember('server-id', 'target-id', user);

      expect(serverService.removeMember).toHaveBeenCalledWith(
        'server-id',
        user.sub,
        'target-id',
      );
    });
  });
});
