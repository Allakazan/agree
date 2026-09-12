import { seconds, ThrottlerModuleOptions } from '@nestjs/throttler';

/**
 * HTTP rate limits, enforced by the global `ThrottlerGuard` in `AppModule`.
 *
 * A bucket is per client IP **and per route**: `ThrottlerGuard.generateKey`
 * hashes controller + handler + tracker, so `limit` is "requests per IP to one
 * endpoint", not a budget shared across the whole API. `GET /chat/:channelId`
 * is a single handler, though, so every channel shares that route's bucket.
 *
 * The tracker is `req.ip`, which is only the real client behind Cloud Run
 * because `main.ts` sets Express's `trust proxy` (`TRUST_PROXY_HOPS`). Get
 * that wrong and every user lands in the proxy's bucket and throttles the rest.
 *
 * Storage is in-memory, so each instance counts on its own — the same
 * per-process limit the socket.io rooms have. Exact at `--max-instances 1`;
 * past that the effective limit multiplies by the instance count until a Redis
 * storage lands, alongside the socket.io Redis adapter.
 *
 * Gateways are not covered: an `APP_GUARD` never reaches WS handlers (the WS
 * guards context is built without the app config), and this guard reads an
 * HTTP request/response pair, so it must not be `@UseGuards`-ed onto one.
 */
export const throttlerOptions = {
  throttlers: [{ name: 'default', ttl: seconds(60), limit: 120 }],
} satisfies ThrottlerModuleOptions;

/**
 * `POST /auth/login` — the one public route worth attacking, since each try is
 * a password guess. Overrides the `default` throttler on that route only; the
 * block lasts `ttl` from the moment it trips.
 */
export const loginThrottle = {
  default: { ttl: seconds(60), limit: 10 },
};
