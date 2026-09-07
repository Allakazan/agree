import { Socket } from 'socket.io';

const COOKIE_NAME = 'agree_token=';

// agree-app sends the JWT as an httpOnly cookie — the browser attaches
// it to the WS handshake automatically, so we read it here instead of
// relying on JS to pass it in `auth`.
export function extractTokenFromCookieHeader(
  cookieHeader: string | undefined,
): string | undefined {
  const match = cookieHeader
    ?.split(';')
    .map((pair) => pair.trim())
    .find((pair) => pair.startsWith(COOKIE_NAME));

  return match
    ? decodeURIComponent(match.slice(COOKIE_NAME.length))
    : undefined;
}

// Shared by AuthGuard (per-message auth) and WsAuthService (handshake auth)
// so both accept the exact same set of token locations.
export function extractTokenFromSocket(client: Socket): string | undefined {
  const [type, headerToken] =
    client.handshake.headers.authorization?.split(' ') ?? [];
  if (type === 'Bearer' && headerToken) return headerToken;

  const authToken: unknown = client.handshake.auth?.token;
  if (typeof authToken === 'string') return authToken;

  return extractTokenFromCookieHeader(client.handshake.headers.cookie);
}
