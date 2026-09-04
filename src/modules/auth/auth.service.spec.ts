import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';

jest.mock('argon2');

describe('AuthService', () => {
  let service: AuthService;
  let usersService: { findOne: jest.Mock };
  let jwtService: { signAsync: jest.Mock };

  beforeEach(async () => {
    usersService = { findOne: jest.fn() };
    jwtService = { signAsync: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: JwtService, useValue: jwtService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
  });

  it('throws UnauthorizedException when no user is found', async () => {
    usersService.findOne.mockResolvedValue(null);

    await expect(service.signIn('unknown', 'pass')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(usersService.findOne).toHaveBeenCalledWith({
      $or: [{ username: 'unknown' }, { email: 'unknown' }],
    });
  });

  it('throws UnauthorizedException when the password does not match', async () => {
    usersService.findOne.mockResolvedValue({
      id: 'user-id',
      username: 'bruno',
      password: 'hashed',
    });
    (argon2.verify as jest.Mock).mockResolvedValue(false);

    await expect(service.signIn('bruno', 'wrong')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(argon2.verify).toHaveBeenCalledWith('hashed', 'wrong');
  });

  it('returns an access token when credentials are valid', async () => {
    usersService.findOne.mockResolvedValue({
      id: 'user-id',
      username: 'bruno',
      password: 'hashed',
    });
    (argon2.verify as jest.Mock).mockResolvedValue(true);
    jwtService.signAsync.mockResolvedValue('signed-jwt');

    const result = await service.signIn('bruno', 'correct');

    expect(jwtService.signAsync).toHaveBeenCalledWith({
      sub: 'user-id',
      username: 'bruno',
    });
    expect(result).toEqual({ access_token: 'signed-jwt' });
  });
});
