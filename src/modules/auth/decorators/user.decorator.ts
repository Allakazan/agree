import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { Socket } from 'socket.io';
import { LoggedUser } from '../types/loggedUser.type';

export const User = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): LoggedUser => {
    // Assuming the user is attached by AuthGuard: to the request object for
    // HTTP, or to the socket's data object for WS
    if (ctx.getType() === 'ws') {
      const socket = ctx.switchToWs().getClient<Socket>();
      return (socket.data as { user: LoggedUser }).user;
    }

    const request = ctx.switchToHttp().getRequest<Request>();
    return (request as Request & { user: LoggedUser }).user;
  },
);
