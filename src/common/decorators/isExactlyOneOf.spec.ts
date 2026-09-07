import { validate } from 'class-validator';
import { IsExactlyOneOf } from './isExactlyOneOf';

class TestDto {
  @IsExactlyOneOf(['a', 'b'])
  a?: string;

  b?: string;
}

describe('IsExactlyOneOf', () => {
  it('passes when exactly one of the properties is set', async () => {
    const dto = new TestDto();
    dto.a = 'value';

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('passes when the other property is the one set', async () => {
    const dto = new TestDto();
    dto.b = 'value';

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('fails when both properties are set', async () => {
    const dto = new TestDto();
    dto.a = 'value';
    dto.b = 'value';

    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('IsExactlyOneOf');
  });

  it('fails when neither property is set', async () => {
    const dto = new TestDto();

    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('IsExactlyOneOf');
  });
});
