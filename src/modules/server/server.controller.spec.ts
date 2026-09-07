import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ServerController } from './server.controller';
import { ServerService } from './server.service';
import { CreateServerDto } from './dto/create-server.dto';
import { LoggedUser } from '../auth/types/loggedUser.type';

describe('ServerController', () => {
  let controller: ServerController;
  let serverService: { create: jest.Mock; findAll: jest.Mock };
  const user: LoggedUser = { sub: 'user-id', username: 'bruno' };
  const dto: CreateServerDto = {
    name: 'My Server',
    description: 'A server',
    logoImg: 'logo.png',
    bannerImage: 'banner.png',
  };

  beforeEach(async () => {
    serverService = { create: jest.fn(), findAll: jest.fn() };

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
    it('returns all servers from ServerService.findAll', async () => {
      const servers = [{ id: '1', name: 'A' }];
      serverService.findAll.mockResolvedValue(servers);

      const result = await controller.find();

      expect(result).toBe(servers);
    });
  });
});
