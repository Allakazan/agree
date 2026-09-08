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
    it('delegates to AuthService.signIn and sets the httpOnly cookie instead of returning the token', async () => {
      authService.signIn.mockResolvedValue({ access_token: 'jwt' });
      const res = { cookie: jest.fn() };

      const result = await controller.signIn(
        { login: 'bruno', password: 'secret' },
        res as never,
      );

      expect(authService.signIn).toHaveBeenCalledWith('bruno', 'secret');
      expect(res.cookie).toHaveBeenCalledWith(
        'agree_token',
        'jwt',
        expect.objectContaining({ httpOnly: true }),
      );
      expect(result).toEqual({ ok: true });
    });
  });

  describe('logout', () => {
    it('clears the session cookie', () => {
      const res = { clearCookie: jest.fn() };

      const result = controller.logout(res as never);

      expect(res.clearCookie).toHaveBeenCalledWith(
        'agree_token',
        expect.objectContaining({ path: '/' }),
      );
      expect(result).toEqual({ ok: true });
    });
  });

  describe('getProfile', () => {
    it('returns the logged-in user from the request', () => {
      const user: LoggedUser = { sub: 'user-id', username: 'bruno' };

      expect(controller.getProfile(user)).toBe(user);
    });
  });
});
