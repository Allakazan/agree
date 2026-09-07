import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ChannelService } from './channel.service';
import { Channel } from './schemas/channel.schema';
import { UsersService } from '../users/users.service';
import { CreateChannelDto } from './dto/create-channel.dto';

describe('ChannelService', () => {
  let service: ChannelService;
  let saveMock: jest.Mock;
  let findMock: jest.Mock;
  let findByIdMock: jest.Mock;
  let usersService: { isMemberOfServer: jest.Mock };

  class MockChannelModel {
    constructor(public data: unknown) {}
    save() {
      return saveMock(this.data);
    }
    static find = (...args: unknown[]) => findMock(...args);
    static findById = (...args: unknown[]) => findByIdMock(...args);
  }

  beforeEach(async () => {
    saveMock = jest.fn();
    findMock = jest.fn();
    findByIdMock = jest.fn();
    usersService = { isMemberOfServer: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChannelService,
        { provide: getModelToken(Channel.name), useValue: MockChannelModel },
        { provide: UsersService, useValue: usersService },
      ],
    }).compile();

    service = module.get<ChannelService>(ChannelService);
  });

  describe('create', () => {
    it('constructs and saves a new channel with the serverId merged in', async () => {
      const dto: CreateChannelDto = { name: 'general' };
      const savedChannel = { ...dto, serverId: 'server-id', id: 'channel-id' };
      saveMock.mockResolvedValue(savedChannel);

      const result = await service.create('server-id', dto);

      expect(saveMock).toHaveBeenCalledWith({
        name: 'general',
        serverId: 'server-id',
      });
      expect(result).toBe(savedChannel);
    });
  });

  describe('findAllByServer', () => {
    it('filters channels by serverId', async () => {
      const channels = [{ id: '1', name: 'general' }];
      const exec = jest.fn().mockResolvedValue(channels);
      findMock.mockReturnValue({ exec });

      const result = await service.findAllByServer('server-id');

      expect(findMock).toHaveBeenCalledWith({ serverId: 'server-id' });
      expect(result).toBe(channels);
    });
  });

  describe('findById', () => {
    it('returns the channel found by id', async () => {
      const channel = { id: 'channel-id', serverId: 'server-id' };
      const exec = jest.fn().mockResolvedValue(channel);
      findByIdMock.mockReturnValue({ exec });

      const result = await service.findById('channel-id');

      expect(findByIdMock).toHaveBeenCalledWith('channel-id');
      expect(result).toBe(channel);
    });
  });

  describe('isUserMemberOfChannelServer', () => {
    it('returns false when the channel does not exist', async () => {
      const exec = jest.fn().mockResolvedValue(null);
      findByIdMock.mockReturnValue({ exec });

      const result = await service.isUserMemberOfChannelServer(
        'user-id',
        'missing-channel',
      );

      expect(result).toBe(false);
      expect(usersService.isMemberOfServer).not.toHaveBeenCalled();
    });

    it('delegates to usersService.isMemberOfServer when the channel exists', async () => {
      const channel = {
        id: 'channel-id',
        serverId: { toString: () => 'server-id' },
      };
      const exec = jest.fn().mockResolvedValue(channel);
      findByIdMock.mockReturnValue({ exec });
      usersService.isMemberOfServer.mockResolvedValue(true);

      const result = await service.isUserMemberOfChannelServer(
        'user-id',
        'channel-id',
      );

      expect(usersService.isMemberOfServer).toHaveBeenCalledWith(
        'user-id',
        'server-id',
      );
      expect(result).toBe(true);
    });
  });
});
