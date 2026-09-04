import {
  Catch,
  ArgumentsHost,
  WsExceptionFilter,
  BadRequestException,
} from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';

@Catch()
export class WsGlobalExceptionFilter implements WsExceptionFilter {
  catch(exception: Error, host: ArgumentsHost) {
    const client = host.switchToWs().getClient<Socket>();

    let message = 'Internal server error';
    const status = 'error';
    let payload: Record<string, unknown> = {};

    if (exception instanceof BadRequestException) {
      const res = exception.getResponse();
      if (typeof res === 'object' && res !== null) {
        payload = res as Record<string, unknown>;
        message = (payload.message as string) || message;
      }
    } else if (exception instanceof WsException) {
      message = exception.message;
    }

    console.error(status, message, payload);

    client.emit('error', {
      status,
      message,
      ...payload,
    });
  }
}
