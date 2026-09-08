import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ServerService } from './server.service';
import { Server } from './schemas/server.schema';
import { ChannelType } from './schemas/channel.schema';
import { CreateServerDto } from './dto/create-server.dto';
import { CreateChannelDto } from './dto/create-channel.dto';
import { UsersService } from '../users/users.service';

describe('ServerService', () => {
  let service: ServerService;
  let saveMock: jest.Mock;
  let findMock: jest.Mock;
  let findByIdAndUpdateMock: jest.Mock;
  let findByIdMock: jest.Mock;
  let findOneMock: jest.Mock;
  let usersService: { addServerId: jest.Mock; isMemberOfServer: jest.Mock };

  class MockServerModel {
    constructor(public data: CreateServerDto) {}
    save() {
      return saveMock(this.data);
    }
    static find = (...args: unknown[]) => findMock(...args);
    static findByIdAndUpdate = (...args: unknown[]) =>
      findByIdAndUpdateMock(...args);
    static findById = (...args: unknown[]) => findByIdMock(...args);
    static findOne = (...args: unknown[]) => findOneMock(...args);
  }

  beforeEach(async () => {
    saveMock = jest.fn();
    findMock = jest.fn();
    findByIdAndUpdateMock = jest.fn();
    findByIdMock = jest.fn();
    findOneMock = jest.fn();
    usersService = { addServerId: jest.fn(), isMemberOfServer: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ServerService,
        { provide: getModelToken(Server.name), useValue: MockServerModel },
        { provide: UsersService, useValue: usersService },
      ],
    }).compile();

    service = module.get<ServerService>(ServerService);
  });

  describe('create', () => {
    it('constructs and saves a new server with the given dto, then adds the creator as a member', async () => {
      const dto: CreateServerDto = {
        name: 'My Server',
        description: 'A server',
        logoImg: 'logo.png',
        bannerImage: 'banner.png',
      };
      const savedServer = {
        ...dto,
        _id: { toString: () => 'server-id' },
      };
      saveMock.mockResolvedValue(savedServer);
      usersService.addServerId.mockResolvedValue(undefined);

      const result = await service.create(dto, 'creator-id');

      expect(saveMock).toHaveBeenCalledWith(dto);
      expect(usersService.addServerId).toHaveBeenCalledWith(
        'creator-id',
        'server-id',
      );
      expect(result).toBe(savedServer);
    });
  });

  describe('findAll', () => {
    it('returns all servers from the model', async () => {
      const servers = [{ id: '1', name: 'A' }];
      const exec = jest.fn().mockResolvedValue(servers);
      findMock.mockReturnValue({ exec });

      const result = await service.findAll();

      expect(findMock).toHaveBeenCalled();
      expect(exec).toHaveBeenCalled();
      expect(result).toBe(servers);
    });
  });

  describe('createChannel', () => {
    const dto: CreateChannelDto = { name: 'general', type: ChannelType.TEXT };

    it('pushes the channel and returns the newly created subdocument', async () => {
      const newChannel = { _id: 'channel-id', ...dto };
      const exec = jest.fn().mockResolvedValue({ channels: [newChannel] });
      findByIdAndUpdateMock.mockReturnValue({ exec });

      const result = await service.createChannel('server-id', dto);

      expect(findByIdAndUpdateMock).toHaveBeenCalledWith(
        'server-id',
        { $push: { channels: dto } },
        { new: true, runValidators: true },
      );
      expect(result).toBe(newChannel);
    });

    it('throws NotFoundException when the server does not exist', async () => {
      const exec = jest.fn().mockResolvedValue(null);
      findByIdAndUpdateMock.mockReturnValue({ exec });

      await expect(service.createChannel('server-id', dto)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findChannelsByServer', () => {
    it('returns the channels array projected from the server', async () => {
      const channels = [{ _id: 'channel-id', name: 'general', type: 'text' }];
      const exec = jest.fn().mockResolvedValue({ channels });
      findByIdMock.mockReturnValue({ exec });

      const result = await service.findChannelsByServer('server-id');

      expect(findByIdMock).toHaveBeenCalledWith('server-id', { channels: 1 });
      expect(result).toBe(channels);
    });

    it('throws NotFoundException when the server does not exist', async () => {
      const exec = jest.fn().mockResolvedValue(null);
      findByIdMock.mockReturnValue({ exec });

      await expect(service.findChannelsByServer('server-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('isUserMemberOfChannelServer', () => {
    const validChannelId = '507f1f77bcf86cd799439011';

    it('returns false without querying when the channelId is malformed', async () => {
      const result = await service.isUserMemberOfChannelServer(
        'user-id',
        'not-an-id',
      );

      expect(result).toBe(false);
      expect(findOneMock).not.toHaveBeenCalled();
    });

    it('returns false when no server contains the channel', async () => {
      const exec = jest.fn().mockResolvedValue(null);
      findOneMock.mockReturnValue({ exec });

      const result = await service.isUserMemberOfChannelServer(
        'user-id',
        validChannelId,
      );

      expect(result).toBe(false);
      expect(usersService.isMemberOfServer).not.toHaveBeenCalled();
    });

    it('delegates to usersService.isMemberOfServer with the owning server id', async () => {
      const exec = jest
        .fn()
        .mockResolvedValue({ _id: { toString: () => 'server-id' } });
      findOneMock.mockReturnValue({ exec });
      usersService.isMemberOfServer.mockResolvedValue(true);

      const result = await service.isUserMemberOfChannelServer(
        'user-id',
        validChannelId,
      );

      expect(usersService.isMemberOfServer).toHaveBeenCalledWith(
        'user-id',
        'server-id',
      );
      expect(result).toBe(true);
    });
  });

  describe('findChannelForMember', () => {
    const validChannelId = '507f1f77bcf86cd799439011';
    const channel = {
      _id: validChannelId,
      name: 'lounge',
      type: ChannelType.VOICE,
    };

    const mockServer = (value: unknown) =>
      findOneMock.mockReturnValue({ exec: jest.fn().mockResolvedValue(value) });

    it('returns null without querying when the channelId is malformed', async () => {
      const result = await service.findChannelForMember('user-id', 'not-an-id');

      expect(result).toBeNull();
      expect(findOneMock).not.toHaveBeenCalled();
    });

    it('projects the matched channel alongside the server id', async () => {
      mockServer({
        _id: { toString: () => 'server-id' },
        channels: [channel],
      });
      usersService.isMemberOfServer.mockResolvedValue(true);

      const result = await service.findChannelForMember(
        'user-id',
        validChannelId,
      );

      expect(findOneMock).toHaveBeenCalledWith(
        { 'channels._id': new Types.ObjectId(validChannelId) },
        { _id: 1, 'channels.$': 1 },
      );
      expect(result).toBe(channel);
    });

    it('returns null when no server contains the channel', async () => {
      mockServer(null);

      const result = await service.findChannelForMember(
        'user-id',
        validChannelId,
      );

      expect(result).toBeNull();
      expect(usersService.isMemberOfServer).not.toHaveBeenCalled();
    });

    it('returns null when the user is not a member of the owning server', async () => {
      mockServer({
        _id: { toString: () => 'server-id' },
        channels: [channel],
      });
      usersService.isMemberOfServer.mockResolvedValue(false);

      const result = await service.findChannelForMember(
        'user-id',
        validChannelId,
      );

      expect(usersService.isMemberOfServer).toHaveBeenCalledWith(
        'user-id',
        'server-id',
      );
      expect(result).toBeNull();
    });

    it('returns null when the projection came back with no channel', async () => {
      mockServer({ _id: { toString: () => 'server-id' }, channels: [] });

      const result = await service.findChannelForMember(
        'user-id',
        validChannelId,
      );

      expect(result).toBeNull();
      expect(usersService.isMemberOfServer).not.toHaveBeenCalled();
    });
  });
});
