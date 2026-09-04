import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const User = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    // Assuming the user is attached by AuthGuard: to the request object for
    // HTTP, or to the socket's data object for WS
    if (ctx.getType() === 'ws') {
      return ctx.switchToWs().getClient().data.user;
    }

    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
