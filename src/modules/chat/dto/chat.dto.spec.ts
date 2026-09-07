import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ChatMessageDto } from './chat.dto';

describe('ChatMessageDto', () => {
  it('is valid with only channelId set', async () => {
    const dto = plainToInstance(ChatMessageDto, {
      message: 'hello',
      channelId: '507f1f77bcf86cd799439011',
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('is valid with only recipientIds set', async () => {
    const dto = plainToInstance(ChatMessageDto, {
      message: 'hello',
      recipientIds: ['507f1f77bcf86cd799439011'],
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('is invalid when both channelId and recipientIds are provided', async () => {
    const dto = plainToInstance(ChatMessageDto, {
      message: 'hello',
      channelId: '507f1f77bcf86cd799439011',
      recipientIds: ['507f1f77bcf86cd799439011'],
    });

    const errors = await validate(dto);

    expect(
      errors.some((e) => e.constraints && 'IsExactlyOneOf' in e.constraints),
    ).toBe(true);
  });

  it('is invalid when neither channelId nor recipientIds is provided', async () => {
    const dto = plainToInstance(ChatMessageDto, {
      message: 'hello',
    });

    const errors = await validate(dto);

    expect(
      errors.some((e) => e.constraints && 'IsExactlyOneOf' in e.constraints),
    ).toBe(true);
  });

  it('rejects recipientIds entries that are not valid ObjectIDs', async () => {
    const dto = plainToInstance(ChatMessageDto, {
      message: 'hello',
      recipientIds: ['not-an-object-id'],
    });

    const errors = await validate(dto);

    const recipientError = errors.find((e) => e.property === 'recipientIds');
    expect(recipientError?.constraints).toHaveProperty('IsObjectID');
  });
});
