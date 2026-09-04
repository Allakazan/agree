import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ServerService } from './server.service';
import { Server } from './schemas/server.schema';
import { CreateServerDto } from './dto/create-server.dto';

describe('ServerService', () => {
  let service: ServerService;
  let saveMock: jest.Mock;
  let findMock: jest.Mock;

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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ServerService,
        { provide: getModelToken(Server.name), useValue: MockServerModel },
      ],
    }).compile();

    service = module.get<ServerService>(ServerService);
  });

  describe('create', () => {
    it('constructs and saves a new server with the given dto', async () => {
      const dto: CreateServerDto = {
        name: 'My Server',
        description: 'A server',
        logoImg: 'logo.png',
        bannerImage: 'banner.png',
      };
      const savedServer = { ...dto, id: 'server-id' };
      saveMock.mockResolvedValue(savedServer);

      const result = await service.create(dto);

      expect(saveMock).toHaveBeenCalledWith(dto);
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
