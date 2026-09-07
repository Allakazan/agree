import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { UsersService } from './users.service';
import { User } from './schemas/user.schema';

describe('UsersService', () => {
  let service: UsersService;
  let userModel: {
    findOne: jest.Mock;
    updateOne: jest.Mock;
    exists: jest.Mock;
    find: jest.Mock;
  };

  beforeEach(async () => {
    userModel = {
      findOne: jest.fn(),
      updateOne: jest.fn(),
      exists: jest.fn(),
      find: jest.fn(),
    };

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

  describe('addServerId', () => {
    it('adds the server id to the user via $addToSet', async () => {
      const exec = jest.fn().mockResolvedValue(undefined);
      userModel.updateOne.mockReturnValue({ exec });

      await service.addServerId('user-id', 'server-id');

      expect(userModel.updateOne).toHaveBeenCalledWith(
        { _id: 'user-id' },
        { $addToSet: { serverIds: 'server-id' } },
      );
      expect(exec).toHaveBeenCalled();
    });
  });

  describe('isMemberOfServer', () => {
    it('returns true when the user exists with the given serverId', async () => {
      userModel.exists.mockResolvedValue({ _id: 'user-id' });

      const result = await service.isMemberOfServer('user-id', 'server-id');

      expect(userModel.exists).toHaveBeenCalledWith({
        _id: 'user-id',
        serverIds: 'server-id',
      });
      expect(result).toBe(true);
    });

    it('returns false when no matching user exists', async () => {
      userModel.exists.mockResolvedValue(null);

      const result = await service.isMemberOfServer('user-id', 'server-id');

      expect(result).toBe(false);
    });
  });

  describe('findManyByIds', () => {
    it('queries the user model with $in and returns the results', async () => {
      const foundUsers = [{ id: 'a' }, { id: 'b' }];
      const exec = jest.fn().mockResolvedValue(foundUsers);
      userModel.find.mockReturnValue({ exec });

      const result = await service.findManyByIds(['a', 'b']);

      expect(userModel.find).toHaveBeenCalledWith({
        _id: { $in: ['a', 'b'] },
      });
      expect(result).toBe(foundUsers);
    });
  });
});
