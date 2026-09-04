import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { UsersService } from './users.service';
import { User } from './schemas/user.schema';

describe('UsersService', () => {
  let service: UsersService;
  let userModel: { findOne: jest.Mock };

  beforeEach(async () => {
    userModel = { findOne: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getModelToken(User.name), useValue: userModel },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('queries the user model with the given filter and returns the result', async () => {
    const foundUser = { id: 'user-id', username: 'bruno' };
    const exec = jest.fn().mockResolvedValue(foundUser);
    userModel.findOne.mockReturnValue({ exec });

    const filter = { username: 'bruno' };
    const result = await service.findOne(filter);

    expect(userModel.findOne).toHaveBeenCalledWith(filter);
    expect(exec).toHaveBeenCalled();
    expect(result).toBe(foundUser);
  });

  it('returns null when no user matches the filter', async () => {
    const exec = jest.fn().mockResolvedValue(null);
    userModel.findOne.mockReturnValue({ exec });

    const result = await service.findOne({ username: 'missing' });

    expect(result).toBeNull();
  });
});
