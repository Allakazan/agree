import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { AuthGuard } from './auth.guard';
import { IS_PUBLIC_KEY } from '../decorators/ispublic.decorator';

describe('AuthGuard', () => {
  let guard: AuthGuard;
  let jwtService: { verifyAsync: jest.Mock };
  let reflector: { getAllAndOverride: jest.Mock };
  let configService: { get: jest.Mock };

  beforeEach(() => {
    jwtService = { verifyAsync: jest.fn() };
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
    configService = { get: jest.fn().mockReturnValue('secret') };

    guard = new AuthGuard(
      jwtService as never,
      reflector as never,
      configService as never,
    );
  });

  const httpContext = (request: object): ExecutionContext =>
    ({
      getType: () => 'http',
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
      switchToHttp: () => ({ getRequest: () => request }),
      switchToWs: () => {
        throw new Error('not a ws context');
      },
    }) as unknown as ExecutionContext;

  const wsContext = (client: object): ExecutionContext =>
    ({
      getType: () => 'ws',
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
      switchToWs: () => ({ getClient: () => client }),
      switchToHttp: () => {
        throw new Error('not an http context');
      },
    }) as unknown as ExecutionContext;

  it('allows access without checking the token when the route is public', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const context = httpContext({ headers: {} });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
  });

  it('reads the isPublic metadata via the IS_PUBLIC_KEY', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const context = httpContext({ headers: {} });

    await guard.canActivate(context);

    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(
      IS_PUBLIC_KEY,
      expect.any(Array),
    );
  });

  describe('HTTP requests', () => {
    it('throws UnauthorizedException when there is no Authorization header', async () => {
      const context = httpContext({ headers: {} });

      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException when the header is not a Bearer token', async () => {
      const context = httpContext({
        headers: { authorization: 'Basic abc123' },
      });

      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException when jwt verification fails', async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('invalid'));
      const context = httpContext({
        headers: { authorization: 'Bearer bad-token' },
      });

      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('attaches the decoded payload to the request and allows access', async () => {
      const payload = { sub: 'user-id', username: 'bruno' };
      jwtService.verifyAsync.mockResolvedValue(payload);
      const request: { headers: object; user?: unknown } = {
        headers: { authorization: 'Bearer good-token' },
      };
      const context = httpContext(request);

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(jwtService.verifyAsync).toHaveBeenCalledWith('good-token', {
        secret: 'secret',
      });
      expect(request.user).toEqual(payload);
    });
  });

  describe('WS requests', () => {
    it('throws WsException when there is no token in headers or auth', async () => {
      const context = wsContext({
        handshake: { headers: {}, auth: {} },
        data: {},
      });

      await expect(guard.canActivate(context)).rejects.toThrow(WsException);
    });

    it('throws WsException when jwt verification fails', async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('invalid'));
      const context = wsContext({
        handshake: { headers: { authorization: 'Bearer bad-token' }, auth: {} },
        data: {},
      });

      await expect(guard.canActivate(context)).rejects.toThrow(WsException);
    });

    it('extracts the token from the Authorization header and attaches the payload to socket.data', async () => {
      const payload = { sub: 'user-id', username: 'bruno' };
      jwtService.verifyAsync.mockResolvedValue(payload);
      const client: { handshake: object; data: { user?: unknown } } = {
        handshake: {
          headers: { authorization: 'Bearer good-token' },
          auth: {},
        },
        data: {},
      };
      const context = wsContext(client);

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(jwtService.verifyAsync).toHaveBeenCalledWith('good-token', {
        secret: 'secret',
      });
      expect(client.data.user).toEqual(payload);
    });

    it('falls back to handshake.auth.token when there is no Authorization header', async () => {
      const payload = { sub: 'user-id', username: 'bruno' };
      jwtService.verifyAsync.mockResolvedValue(payload);
      const client: { handshake: object; data: { user?: unknown } } = {
        handshake: { headers: {}, auth: { token: 'auth-token' } },
        data: {},
      };
      const context = wsContext(client);

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(jwtService.verifyAsync).toHaveBeenCalledWith('auth-token', {
        secret: 'secret',
      });
      expect(client.data.user).toEqual(payload);
    });

    it('falls back to the agree_token cookie when there is no header or auth token', async () => {
      const payload = { sub: 'user-id', username: 'bruno' };
      jwtService.verifyAsync.mockResolvedValue(payload);
      const client: { handshake: object; data: { user?: unknown } } = {
        handshake: {
          headers: { cookie: 'other=1; agree_token=cookie-token; foo=bar' },
          auth: {},
        },
        data: {},
      };
      const context = wsContext(client);

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(jwtService.verifyAsync).toHaveBeenCalledWith('cookie-token', {
        secret: 'secret',
      });
      expect(client.data.user).toEqual(payload);
    });
  });
});
