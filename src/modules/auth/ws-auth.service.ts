import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Socket } from 'socket.io';
import { LoggedUser } from './types/loggedUser.type';
import { extractTokenFromSocket } from './utils/ws-token';

// Handshake-time authentication for WS gateways. Unlike AuthGuard this never
// throws — connection handlers run outside the exception filter, so the caller
// decides what to do with an anonymous socket (disconnect it).
@Injectable()
export class WsAuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async authenticate(client: Socket): Promise<LoggedUser | null> {
    const token = extractTokenFromSocket(client);
    if (!token) return null;

    try {
      return await this.jwtService.verifyAsync<LoggedUser>(token, {
        secret: this.configService.get<string>('auth.secret'),
      });
    } catch {
      return null;
    }
  }
}
