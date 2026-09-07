import { validate } from 'class-validator';
import { IsObjectID } from './isObjectID';

class TestDto {
  @IsObjectID()
  id: string;
}

class TestArrayDto {
  @IsObjectID({ each: true })
  ids: string[];
}

describe('IsObjectID', () => {
  it('passes for a valid 24-char hex ObjectID', async () => {
    const dto = new TestDto();
    dto.id = '507f1f77bcf86cd799439011';

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it.each([
    ['too short', '507f1f77bcf86cd79943901'],
    ['too long', '507f1f77bcf86cd7994390111'],
    ['non-hex characters', '507f1f77bcf86cd79943901z'],
    ['empty string', ''],
  ])('fails for %s', async (_label, value) => {
    const dto = new TestDto();
    dto.id = value;

    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('IsObjectID');
    expect(errors[0].constraints?.IsObjectID).toBe(
      ' id must be a valid ObjectID',
    );
  });

  it('passes for an array of valid ObjectIDs when used with each: true', async () => {
    const dto = new TestArrayDto();
    dto.ids = ['507f1f77bcf86cd799439011', '507f191e810c19729de860ea'];

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('fails when any element of the array is not a valid ObjectID', async () => {
    const dto = new TestArrayDto();
    dto.ids = ['507f1f77bcf86cd799439011', 'not-an-object-id'];

    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('IsObjectID');
  });
});
