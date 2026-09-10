import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
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
  let usersService: {
    addServerId: jest.Mock;
    isMemberOfServer: jest.Mock;
    findOne: jest.Mock;
    removeServerId: jest.Mock;
    findMembersOfServer: jest.Mock;
  };

  class MockServerModel {
    constructor(public data: CreateServerDto) {}
    save(): unknown {
      return saveMock(this.data);
    }
    static find = (...args: unknown[]): unknown => findMock(...args);
    static findByIdAndUpdate = (...args: unknown[]): unknown =>
      findByIdAndUpdateMock(...args);
    static findById = (...args: unknown[]): unknown => findByIdMock(...args);
    static findOne = (...args: unknown[]): unknown => findOneMock(...args);
  }

  beforeEach(async () => {
    saveMock = jest.fn();
    findMock = jest.fn();
    findByIdAndUpdateMock = jest.fn();
    findByIdMock = jest.fn();
    findOneMock = jest.fn();
    usersService = {
      addServerId: jest.fn(),
      isMemberOfServer: jest.fn(),
      findOne: jest.fn(),
      removeServerId: jest.fn(),
      findMembersOfServer: jest.fn(),
    };

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

      expect(saveMock).toHaveBeenCalledWith({ ...dto, ownerId: 'creator-id' });
      expect(usersService.addServerId).toHaveBeenCalledWith(
        'creator-id',
        'server-id',
      );
      expect(result).toBe(savedServer);
    });
  });

  describe('findAll', () => {
    it("returns only the servers in the caller's serverIds", async () => {
      const servers = [{ id: '1', name: 'A' }];
      const exec = jest.fn().mockResolvedValue(servers);
      findMock.mockReturnValue({ exec });
      usersService.findOne.mockResolvedValue({
        serverIds: ['server-1', 'server-2'],
      });

      const result = await service.findAll('user-id');

      expect(usersService.findOne).toHaveBeenCalledWith({ _id: 'user-id' });
      expect(findMock).toHaveBeenCalledWith({
        _id: { $in: ['server-1', 'server-2'] },
      });
      expect(exec).toHaveBeenCalled();
      expect(result).toBe(servers);
    });

    it('returns an empty array without querying when the user has no servers', async () => {
      usersService.findOne.mockResolvedValue({ serverIds: [] });

      const result = await service.findAll('user-id');

      expect(result).toEqual([]);
      expect(findMock).not.toHaveBeenCalled();
    });

    it('returns an empty array when the user does not exist', async () => {
      usersService.findOne.mockResolvedValue(null);

      const result = await service.findAll('user-id');

      expect(result).toEqual([]);
      expect(findMock).not.toHaveBeenCalled();
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
    it('returns the channels array projected from the server when the caller is a member', async () => {
      const channels = [{ _id: 'channel-id', name: 'general', type: 'text' }];
      const exec = jest.fn().mockResolvedValue({ channels });
      findByIdMock.mockReturnValue({ exec });
      usersService.isMemberOfServer.mockResolvedValue(true);

      const result = await service.findChannelsByServer('server-id', 'user-id');

      expect(findByIdMock).toHaveBeenCalledWith('server-id', { channels: 1 });
      expect(usersService.isMemberOfServer).toHaveBeenCalledWith(
        'user-id',
        'server-id',
      );
      expect(result).toBe(channels);
    });

    it('throws NotFoundException when the server does not exist', async () => {
      const exec = jest.fn().mockResolvedValue(null);
      findByIdMock.mockReturnValue({ exec });

      await expect(
        service.findChannelsByServer('server-id', 'user-id'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when the caller is not a member', async () => {
      const channels = [{ _id: 'channel-id', name: 'general', type: 'text' }];
      const exec = jest.fn().mockResolvedValue({ channels });
      findByIdMock.mockReturnValue({ exec });
      usersService.isMemberOfServer.mockResolvedValue(false);

      await expect(
        service.findChannelsByServer('server-id', 'user-id'),
      ).rejects.toThrow(NotFoundException);
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

  describe('findMembers', () => {
    it('returns the roster when the caller is a member', async () => {
      const members = [{ id: 'a' }, { id: 'b' }];
      findByIdMock.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ _id: 'server-id' }),
      });
      usersService.isMemberOfServer.mockResolvedValue(true);
      usersService.findMembersOfServer.mockResolvedValue(members);

      const result = await service.findMembers('server-id', 'user-id');

      expect(usersService.findMembersOfServer).toHaveBeenCalledWith(
        'server-id',
      );
      expect(result).toBe(members);
    });

    it('throws NotFoundException when the server does not exist', async () => {
      findByIdMock.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

      await expect(service.findMembers('server-id', 'user-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when the caller is not a member', async () => {
      findByIdMock.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ _id: 'server-id' }),
      });
      usersService.isMemberOfServer.mockResolvedValue(false);

      await expect(service.findMembers('server-id', 'user-id')).rejects.toThrow(
        NotFoundException,
      );
      expect(usersService.findMembersOfServer).not.toHaveBeenCalled();
    });
  });

  describe('addMember', () => {
    const mockOwnedServer = (ownerId: string | undefined) =>
      findByIdMock.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ _id: 'server-id', ownerId }),
      });

    it('adds the target user when the caller is the owner', async () => {
      mockOwnedServer('owner-id');
      usersService.findOne.mockResolvedValue({ _id: 'target-id' });
      usersService.addServerId.mockResolvedValue(undefined);

      await service.addMember('server-id', 'owner-id', 'target-id');

      expect(usersService.addServerId).toHaveBeenCalledWith(
        'target-id',
        'server-id',
      );
    });

    it('throws ForbiddenException when the caller is not the owner', async () => {
      mockOwnedServer('owner-id');

      await expect(
        service.addMember('server-id', 'someone-else', 'target-id'),
      ).rejects.toThrow(ForbiddenException);
      expect(usersService.addServerId).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when the server has no owner yet', async () => {
      mockOwnedServer(undefined);

      await expect(
        service.addMember('server-id', 'owner-id', 'target-id'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when the server does not exist', async () => {
      findByIdMock.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

      await expect(
        service.addMember('server-id', 'owner-id', 'target-id'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when the target user does not exist', async () => {
      mockOwnedServer('owner-id');
      usersService.findOne.mockResolvedValue(null);

      await expect(
        service.addMember('server-id', 'owner-id', 'target-id'),
      ).rejects.toThrow(NotFoundException);
      expect(usersService.addServerId).not.toHaveBeenCalled();
    });
  });

  describe('removeMember', () => {
    const mockOwnedServer = (ownerId: string | undefined) =>
      findByIdMock.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ _id: 'server-id', ownerId }),
      });

    it('removes the target user when the caller is the owner', async () => {
      mockOwnedServer('owner-id');
      usersService.removeServerId.mockResolvedValue(undefined);

      await service.removeMember('server-id', 'owner-id', 'target-id');

      expect(usersService.removeServerId).toHaveBeenCalledWith(
        'target-id',
        'server-id',
      );
    });

    it('throws ForbiddenException when the caller is not the owner', async () => {
      mockOwnedServer('owner-id');

      await expect(
        service.removeMember('server-id', 'someone-else', 'target-id'),
      ).rejects.toThrow(ForbiddenException);
      expect(usersService.removeServerId).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when the owner tries to remove themselves', async () => {
      mockOwnedServer('owner-id');

      await expect(
        service.removeMember('server-id', 'owner-id', 'owner-id'),
      ).rejects.toThrow(BadRequestException);
      expect(usersService.removeServerId).not.toHaveBeenCalled();
    });
  });
});
