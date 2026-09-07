import { ConfigService } from '@nestjs/config';

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { WsException } from '@nestjs/websockets';
import { Request } from 'express';
import { Socket } from 'socket.io';
import { LoggedUser } from '../types/loggedUser.type';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/ispublic.decorator';
import { extractTokenFromSocket } from '../utils/ws-token';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private reflector: Reflector,
    private configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) return true;

    const isWs = context.getType() === 'ws';

    const token = isWs
      ? extractTokenFromSocket(context.switchToWs().getClient<Socket>())
      : this.extractTokenFromHeader(
          context.switchToHttp().getRequest<Request>(),
        );

    if (!token) {
      throw isWs
        ? new WsException('Unauthorized')
        : new UnauthorizedException();
    }

    try {
      const payload = await this.jwtService.verifyAsync<LoggedUser>(token, {
        secret: this.configService.get<string>('auth.secret'),
      });

      if (isWs) {
        // 💡 We're assigning the payload to the socket's data object here
        // so that we can access it in our gateway handlers via @User()
        (
          context.switchToWs().getClient<Socket>().data as { user: LoggedUser }
        ).user = payload;
      } else {
        // 💡 We're assigning the payload to the request object here
        // so that we can access it in our route handlers
        (
          context.switchToHttp().getRequest<Request>() as Request & {
            user: LoggedUser;
          }
        ).user = payload;
      }
    } catch {
      throw isWs
        ? new WsException('Unauthorized')
        : new UnauthorizedException();
    }
    return true;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
