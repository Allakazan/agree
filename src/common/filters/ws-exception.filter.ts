import {
  Catch,
  ArgumentsHost,
  WsExceptionFilter,
  BadRequestException,
} from '@nestjs/common';
import { WsException } from '@nestjs/websockets';

@Catch()
export class WsGlobalExceptionFilter implements WsExceptionFilter {
  catch(exception: any, host: ArgumentsHost) {
    const client = host.switchToWs().getClient();

    let message = 'Internal server error';
    let status = 'error';
    let payload = {};

    if (exception instanceof BadRequestException) {
      const res = exception.getResponse();
      message = res['message'] || message;
      payload = res;
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
