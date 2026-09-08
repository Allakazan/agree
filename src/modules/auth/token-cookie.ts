import type { Response } from 'express';

/** Name of the httpOnly cookie holding the JWT. Read by {@link AuthGuard} on both HTTP and WS. */
export const TOKEN_COOKIE = 'agree_token';

/** Matches `AuthModule`'s JWT `expiresIn: '7d'`. */
const TOKEN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Sets the httpOnly session cookie on the login response. */
export function setTokenCookie(res: Response, token: string) {
  res.cookie(TOKEN_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: TOKEN_MAX_AGE_MS,
  });
}

/** Clears the session cookie (sign-out). */
export function clearTokenCookie(res: Response) {
  res.clearCookie(TOKEN_COOKIE, { path: '/' });
}
