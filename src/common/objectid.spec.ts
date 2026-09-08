import { Types } from 'mongoose';
import { toObjectId } from './objectid';

describe('toObjectId', () => {
  it('parses a valid 24-character hex id', () => {
    const result = toObjectId('507f1f77bcf86cd799439011');

    expect(result).toBeInstanceOf(Types.ObjectId);
    expect(result?.toString()).toBe('507f1f77bcf86cd799439011');
  });

  it('returns null for a malformed id instead of throwing', () => {
    expect(toObjectId('not-an-id')).toBeNull();
    expect(toObjectId('')).toBeNull();
  });
});
