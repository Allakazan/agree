// ws-validation.pipe.ts
import {
  PipeTransform,
  Injectable,
  ArgumentMetadata,
  BadRequestException,
  Type,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

@Injectable()
export class WsValidationPipe implements PipeTransform {
  async transform(
    value: object,
    { metatype }: ArgumentMetadata,
  ): Promise<object> {
    if (!metatype || !this.toValidate(metatype)) {
      return value;
    }

    const object: object = plainToInstance(metatype, value) as object;
    const errors = await validate(object);

    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: errors.map((err) => ({
          property: err.property,
          constraints: err.constraints,
        })),
      });
    }

    return object;
  }

  private toValidate(metatype: Type<unknown>): boolean {
    const types: Type<unknown>[] = [String, Boolean, Number, Array, Object];
    return !types.includes(metatype);
  }
}
