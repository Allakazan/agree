import { ArgumentMetadata, BadRequestException } from '@nestjs/common';
import { IsString, IsNotEmpty } from 'class-validator';
import { WsValidationPipe } from './ws-validation.pipe';

class TestDto {
  @IsString()
  @IsNotEmpty()
  content: string;
}

describe('WsValidationPipe', () => {
  let pipe: WsValidationPipe;

  beforeEach(() => {
    pipe = new WsValidationPipe();
  });

  const metadata = (metatype?: unknown): ArgumentMetadata => ({
    type: 'body',
    metatype: metatype as ArgumentMetadata['metatype'],
    data: '',
  });

  it('returns the value unchanged when there is no metatype', async () => {
    const value = { content: 'hello' };

    await expect(pipe.transform(value, metadata(undefined))).resolves.toBe(
      value,
    );
  });

  it.each([String, Boolean, Number, Array, Object])(
    'returns the value unchanged for native type %p',
    async (metatype) => {
      const value = { content: 'hello' };

      await expect(pipe.transform(value, metadata(metatype))).resolves.toBe(
        value,
      );
    },
  );

  it('returns a transformed instance when validation passes', async () => {
    const value = { content: 'hello' };

    const result = await pipe.transform(value, metadata(TestDto));

    expect(result).toBeInstanceOf(TestDto);
    expect(result).toEqual({ content: 'hello' });
  });

  it('throws a BadRequestException with formatted errors when validation fails', async () => {
    const value = { content: '' };

    await expect(pipe.transform(value, metadata(TestDto))).rejects.toThrow(
      BadRequestException,
    );

    try {
      await pipe.transform(value, metadata(TestDto));
      fail('expected transform to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const response = (error as BadRequestException).getResponse() as {
        message: string;
        errors: { property: string; constraints: Record<string, string> }[];
      };
      expect(response.message).toBe('Validation failed');
      expect(response.errors).toHaveLength(1);
      expect(response.errors[0].property).toBe('content');
      expect(response.errors[0].constraints).toHaveProperty('isNotEmpty');
    }
  });
});
