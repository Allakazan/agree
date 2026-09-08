import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

/**
 * Allowed browser origins: `ORIGIN` (comma-separated) when set, otherwise
 * everything — an unset `ORIGIN` means development. Shared by the HTTP layer
 * and every gateway: both are served by the same server on `$PORT`, so they
 * answer to the same list.
 *
 * `true` rather than `'*'`: both configs below set `credentials: true`, and a
 * browser rejects `Access-Control-Allow-Origin: *` on a credentialed request.
 * The WS handshake can authenticate from the `agree_token` cookie, so `'*'`
 * would break exactly the case it is meant to make easy. `true` echoes the
 * caller's own origin back — allows everything *and* keeps credentials working.
 */
export const corsOrigins: string[] | true = process.env.ORIGIN
  ? process.env.ORIGIN.split(',').map((origin) => origin.trim())
  : true;

/** CORS for the REST API and Swagger UI. */
export const httpCorsOptions: CorsOptions = {
  origin: corsOrigins,
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  credentials: true,
};

/**
 * CORS for the socket.io handshake. Only the polling transport is subject to
 * it — a native WebSocket upgrade skips CORS entirely — but socket.io tries
 * polling first by default, so it still gates the connection in practice.
 */
export const wsCorsOptions = {
  origin: corsOrigins,
  methods: ['GET', 'POST'],
  credentials: true,
};
