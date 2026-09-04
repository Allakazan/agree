import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LoggedUser } from './types/loggedUser.type';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: { signIn: jest.Mock };

  beforeEach(async () => {
    authService = { signIn: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  describe('signIn', () => {
    it('delegates to AuthService.signIn with the login and password', async () => {
      authService.signIn.mockResolvedValue({ access_token: 'jwt' });

      const result = await controller.signIn({
        login: 'bruno',
        password: 'secret',
      });

      expect(authService.signIn).toHaveBeenCalledWith('bruno', 'secret');
      expect(result).toEqual({ access_token: 'jwt' });
    });
  });

  describe('getProfile', () => {
    it('returns the logged-in user from the request', () => {
      const user: LoggedUser = { sub: 'user-id', username: 'bruno' };

      expect(controller.getProfile(user)).toBe(user);
    });
  });
});
