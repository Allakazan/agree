import {
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
} from 'class-validator';

export function IsExactlyOneOf(
  properties: string[],
  validationOptions?: ValidationOptions,
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'IsExactlyOneOf',
      target: object.constructor,
      propertyName,
      constraints: [properties],
      options: validationOptions,
      validator: {
        validate(_value: unknown, args: ValidationArguments) {
          const [props] = args.constraints as [string[]];
          const obj = args.object as Record<string, unknown>;
          return props.filter((p) => obj[p] !== undefined).length === 1;
        },
        defaultMessage: () =>
          `Exactly one of ${properties.join(', ')} must be provided`,
      },
    });
  };
}
