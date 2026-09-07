import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ServerService } from './server.service';
import { Server } from './schemas/server.schema';
import { CreateServerDto } from './dto/create-server.dto';
import { UsersService } from '../users/users.service';

describe('ServerService', () => {
  let service: ServerService;
  let saveMock: jest.Mock;
  let findMock: jest.Mock;
  let usersService: { addServerId: jest.Mock };

  class MockServerModel {
    constructor(public data: CreateServerDto) {}
    save() {
      return saveMock(this.data);
    }
    static find = (...args: unknown[]) => findMock(...args);
  }

  beforeEach(async () => {
    saveMock = jest.fn();
    findMock = jest.fn();
    usersService = { addServerId: jest.fn() };

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
});
