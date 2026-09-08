import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController', () => {
  let controller: UsersController;
  let usersService: { findAllExcept: jest.Mock };

  beforeEach(async () => {
    usersService = { findAllExcept: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: usersService }],
    }).compile();

    controller = module.get<UsersController>(UsersController);
  });

  describe('findAll', () => {
    it('lists everyone except the caller, exposing only public fields', async () => {
      usersService.findAllExcept.mockResolvedValue([
        {
          _id: 'user-a',
          username: 'ana',
          email: 'ana@example.com',
          password: 'hashed',
          profileImageUrl: 'http://example.com/ana.png',
        },
        {
          _id: 'user-b',
          username: 'bruno',
          email: 'bruno@example.com',
          password: 'hashed',
          profileImageUrl: '',
        },
      ]);

      const result = await controller.findAll({
        sub: 'caller-id',
        username: 'caller',
      });

      expect(usersService.findAllExcept).toHaveBeenCalledWith('caller-id');
      expect(result).toEqual([
        { id: 'user-a', username: 'ana', profileImageUrl: 'http://example.com/ana.png' },
        { id: 'user-b', username: 'bruno', profileImageUrl: null },
      ]);
    });
  });
});
