import { ArgumentsHost, BadRequestException } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { WsGlobalExceptionFilter } from './ws-exception.filter';

describe('WsGlobalExceptionFilter', () => {
  let filter: WsGlobalExceptionFilter;
  let client: { emit: jest.Mock };
  let host: ArgumentsHost;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    filter = new WsGlobalExceptionFilter();
    client = { emit: jest.fn() };
    host = {
      switchToWs: () => ({
        getClient: () => client as unknown as Socket,
      }),
    } as unknown as ArgumentsHost;
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('emits a generic internal server error for unknown exceptions', () => {
    filter.catch(new Error('boom'), host);

    expect(client.emit).toHaveBeenCalledWith('error', {
      status: 'error',
      message: 'Internal server error',
    });
  });

  it('emits the WsException message', () => {
    filter.catch(new WsException('not allowed'), host);

    expect(client.emit).toHaveBeenCalledWith('error', {
      status: 'error',
      message: 'not allowed',
    });
  });

  it('emits the BadRequestException response payload merged in', () => {
    const exception = new BadRequestException({
      message: 'Validation failed',
      errors: [{ property: 'content', constraints: { isNotEmpty: 'bad' } }],
    });

    filter.catch(exception, host);

    expect(client.emit).toHaveBeenCalledWith('error', {
      status: 'error',
      message: 'Validation failed',
      errors: [{ property: 'content', constraints: { isNotEmpty: 'bad' } }],
    });
  });

  it('falls back to the default message when the BadRequestException response has no message', () => {
    const exception = new BadRequestException({ errors: [] });

    filter.catch(exception, host);

    expect(client.emit).toHaveBeenCalledWith('error', {
      status: 'error',
      message: 'Internal server error',
      errors: [],
    });
  });
});
