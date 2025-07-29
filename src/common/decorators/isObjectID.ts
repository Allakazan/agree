import {
  registerDecorator,
  buildMessage,
  ValidationOptions,
} from 'class-validator';

export function IsObjectID(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      name: 'IsObjectID',
      target: object.constructor,
      propertyName: propertyName,
      constraints: [],
      options: validationOptions,
      validator: {
        validate(value: string) {
          // https://github.com/Automattic/mongoose/issues/1959#issuecomment-97457325
          return /^[a-fA-F0-9]{24}$/.test(value);
        },
        defaultMessage: buildMessage(
          (eachPrefix) => `${eachPrefix} $property must be a valid ObjectID`,
          validationOptions,
        ),
      },
    });
  };
}
