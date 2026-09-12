# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Agree is a Discord-clone backend built with NestJS. It uses two databases side by side:
- **MongoDB** (via Mongoose) for servers and users — flexible, document-shaped entities.
- **PostgreSQL** (via Drizzle ORM) for conversations and messages — relational, append-heavy chat data.

Real-time chat is delivered over a Socket.IO WebSocket gateway; REST endpoints are served through standard Nest controllers and documented with Swagger.

## Commands

```bash
# install deps
yarn install

# run
yarn start          # once
yarn start:dev       # watch mode
yarn start:prod       # from dist/, after build

# build
yarn build

# lint / format
yarn lint             # eslint --fix over src/apps/libs/test
yarn format            # prettier --write over src/test

# tests
yarn test                       # unit tests (jest, rootDir: src, *.spec.ts)
yarn test:watch
yarn test:cov
yarn test:e2e                    # uses test/jest-e2e.json
yarn test:debug                   # node --inspect-brk, --runInBand
npx jest path/to/file.spec.ts     # run a single test file
npx jest -t "test name"           # run tests matching a name

# database
yarn mongodb:seed                        # seeds MongoDB via src/seed.ts (ts-node)
npx drizzle-kit generate                 # generate Postgres migrations from src/drizzle/schema.ts
npx drizzle-kit migrate                  # apply migrations (drizzle.config.ts drives this)

# local infra (Mongo, Postgres, Redis)
docker-compose up -d
```

Swagger UI is served at `/api` once the app is running. Env vars live in `.env` (`DATABASE_URL` for Postgres, `MONGODB_URI` for Mongo, `JWT_SECRET`); `.env.example` and the README table are the two places to document a new one. Config factories under `src/config/` are registered in `AppModule`'s `ConfigModule.forRoot({ load: [...] })` and read `process.env` through the `envInt`/`envList` parsers in `src/common/env.ts` — factories stay pure declaration, and a `<= 0` or non-numeric knob takes its default instead of propagating a nonsense value.

## Architecture

**Dual-database split by domain, not by module.** `AppModule` wires up both `MongooseModule` (config from `src/config/database.ts` → `database.mongodb.url`) and, per-feature, `DrizzleModule` (`src/drizzle/drizzle.module.ts`, injected via the `DRIZZLE` token, `database.postgresql.url`). When adding a feature, decide up front which store it belongs in — Mongo for document-like resource data (servers, users), Postgres/Drizzle for relational/chat data (conversations, messages) — rather than assuming one store for everything. Drizzle's schema/types live in `src/drizzle/schema.ts` and `src/drizzle/types/drizzle.d.ts`; Mongoose schemas live per-module under `schemas/*.schema.ts`.

**Auth is global by default.** `AuthModule` registers `AuthGuard` as an `APP_GUARD`, so every route requires a valid Bearer JWT unless explicitly marked with the `@Public()` decorator (`src/modules/auth/decorators/ispublic.decorator.ts`). The guard decodes the JWT and attaches the payload to `request.user`; retrieve it in controllers with the `@User()` decorator (`src/modules/auth/decorators/user.decorator.ts`) rather than reading `req.user` directly. Passwords are hashed with `argon2`. The global `APP_GUARD` registration does **not** reach WS handlers, so `ChatGateway` applies `AuthGuard` explicitly with `@UseGuards` (and `ChatModule` re-provides it, since `AuthModule` doesn't export it). WS tokens are read from the `Authorization` header, `handshake.auth.token`, or the `agree_token` cookie — that extraction lives in `src/modules/auth/utils/ws-token.ts` and is shared by the guard and `WsAuthService`.

**HTTP is rate-limited globally; sockets are not.** `AppModule` registers `@nestjs/throttler`'s `ThrottlerGuard` as a second `APP_GUARD`, with the limits in `src/common/throttle.ts`. A bucket is per client IP *and per route* (the default key hashes controller + handler), and `POST /auth/login` overrides it with a stricter `@Throttle(loginThrottle)`. Opt a route out with `@SkipThrottle()`, as `/health` does. The tracker is `req.ip`, which is only the real client because `main.ts` sets Express `trust proxy` to `TRUST_PROXY_HOPS` (default 1, the Cloud Run proxy). A wrong value puts every user in the proxy's bucket. Like `AuthGuard`, the global registration never reaches WS handlers, and `ThrottlerGuard` reads an HTTP req/res pair, so never `@UseGuards` it onto a gateway: WS throttling needs its own guard subclass. Storage is in-memory, which makes the limits per instance, the same caveat the socket.io rooms have.

**Chat is split: WS in, Postgres for storage, REST for history.** `ChatGateway` (namespace `chat`) receives the `chat` message event, validates the payload with `WsValidationPipe` (`class-validator`, mirrors the HTTP `ValidationPipe` behavior for sockets), and delegates persistence to `ChatService`. `ChatService.createMessagesAndConversation` upserts a `conversations` row keyed by `relatedMongoChannelId` (a Mongo `Server`/channel ObjectID string bridging the two databases) before inserting into `messages`, and returns `{ message, recipients }`. Errors on the socket path are normalized by `WsGlobalExceptionFilter` into a standard `{status, message}` emit on the `error` event — note it only unwraps `BadRequestException`/`WsException`, so throw those from gateway handlers (anything else reaches the client as a generic "Internal server error"). REST reads of history go through `ChatController` → `ChatService.findAll`, which paginates with `limit`/`before` (ISO8601 cursor) over Drizzle.

**Two read paths, split by conversation type.** Channels are read by their Mongo channel id (`GET /chat/:channelId` → `findAllByChannel`, which resolves `relatedMongoChannelId` first); dm/group conversations are read by the Postgres conversation UUID (`GET /chat/conversations/:conversationId` → `findAllByConversation`, authorized against `conversations.participants`). Channel rows have a null `participants`, so the dm route can never read a channel. `GET /chat/conversations` lists the caller's dm/group conversations — declare it *before* `/:channelId` in the controller or that route swallows it. Conversation UUIDs otherwise only reach a client over the socket, so this list route is what survives a page refresh. Ordering uses `conversations.lastMessageAt`, denormalized from the newest message: `ChatService` generates one timestamp per send and writes it both as the message's `createdAt` and via the conversation upsert's `onConflictDoUpdate`, so it costs no extra query and cannot drift.

**Socket.IO rooms are the authorization boundary for channels.** Room names come from `src/modules/chat/chat.rooms.ts` — never build them inline.

- `ChatGateway.handleConnection` authenticates the handshake via `WsAuthService.authenticate` (exported by `AuthModule`), disconnects anonymous sockets, and joins `user:<userId>`.
- Channel rooms are joined **lazily**: the client emits `subscribe { channelId }`, and that handler is the *only* place `ServerService.isUserMemberOfChannelServer` is consulted. `unsubscribe` is the mirror.
- Sending on `chat` requires the socket to already be in `channel:<channelId>` — presence in the room *is* the authorization, so `ChatService.findOrCreateChannelConversation` deliberately performs no membership check and must not be called from a new (e.g. REST) caller without one. Never `join()` a socket on the send path; that would hand write access to any socket that asks.
- DMs/groups are delivered to each participant's `user:<id>` room, so a recipient needs no subscription and never has to know the conversation UUID.
- Rooms are per-process. Running more than one instance needs `@socket.io/redis-adapter` (Redis is in `docker-compose.yml` but not yet wired up).

**Voice is signaling only — media never touches this server.** Cloud Run carries no UDP, so a self-hosted SFU is impossible and audio goes browser↔browser over a P2P mesh. `VoiceGateway` (namespace `voice`) carries presence, relays SDP/ICE, and hands out TURN credentials; that is all. Design rationale lives in `docs/voice-webrtc.md`, the client contract in `docs/voice-client.md`.

- **One authorization gate, same rule as chat.** `voice:join` is the only handler that consults `ServerService.findChannelForMember` (which also lets it reject `type !== VOICE`); every handler after it asserts `client.rooms.has(voiceRoom(channelId))` and **never** calls `join()`. A self-healing join on the signal path would hand a room to any socket that asked. Room names come from `src/modules/voice/voice.rooms.ts` — rooms are per-namespace, so `voice:<id>` is a different room from an identically named one in `chat`.
- **Presence is behind an interface (`VOICE_PRESENCE_STORE`), keyed by socketId.** `InMemoryVoicePresenceService` is correct for exactly one instance — the same limit the socket.io rooms it mirrors already have — and the interface is the Redis seam, so both move together. Every method is async today for that reason.
- **`handleDisconnect` is what makes presence trustworthy.** A closed tab, a dropped network, and Cloud Run's 60-minute request cap all land there; without it each leaves a ghost in the channel forever. It runs outside the exception filter, so it must never throw. Clients are expected to re-`voice:join` after a reconnect — the gateway does not restore anything.
- **One socket per user per channel.** A second join from the same user evicts the older socket (`voice:evicted`, then disconnect) rather than letting a second tab hear itself. A repeated join from the *same* socket is idempotent and just re-acks.
- **Topology promotion is one-way.** `VoiceTopologyService` promotes a room to `sfu` past `meshMax` and only clears it when the room empties (`release`), so a room oscillating at the threshold can't renegotiate on every join. There is no SFU yet, so a join past the limit is rejected outright — that is deliberate, not a stub.
- **Bitrate is a published policy, not an enforced one.** `maxBitrate` is applied client-side via `RTCRtpSender.setParameters()`; the server ships a number in the join ack and trusts the client. Don't add SDP munging or adaptive bitrate — WebRTC's own GCC/TWCC already adapts.
- **`VoiceIceService` never throws.** It degrades static TURN → Cloudflare → STUN-only, because a join must not fail just because a relay provider is down. Minted credentials are per-key, so they're cached and shared across joiners, with concurrent mints collapsed into one in-flight promise.

**Cross-database references are plain strings, not foreign keys.** Postgres `conversations.relatedMongoChannelId` and Drizzle message `senderId` are just Mongo ObjectID strings with no DB-level referential integrity — validate with `@IsObjectID()` (`src/common/decorators/isObjectID.ts`) at the DTO layer instead of relying on the database.

**Gateways share the HTTP port.** `@WebSocketGateway()` carries **no port argument**, so socket.io attaches to the Nest HTTP server and every namespace is reachable on `$PORT` — Cloud Run exposes exactly one port, and a second listener would be unreachable in production. CORS for both HTTP and WS comes from `src/common/cors.ts` (`httpCorsOptions` / `wsCorsOptions`), one origin list driven by the comma-separated `ORIGIN` env var, falling back to `origin: true` (reflect any origin) when it's unset — never `'*'`, since both configs set `credentials: true` and browsers reject the wildcard on credentialed requests, which would break the `agree_token` cookie path. Never inline a `cors` block in a gateway decorator.

## Conventions

- Module layout: `*.module.ts`, `*.controller.ts`, `*.service.ts`, `dto/`, `schemas/` (Mongo) — mirror this when adding a module.
- On WS handlers, attach `WsValidationPipe` to the body param — `@MessageBody(new WsValidationPipe())` — never via `@UsePipes`. A handler-level pipe also runs against `@ConnectedSocket()`, and `plainToInstance(Socket, …)` throws, which surfaces to the client as a generic "Internal server error".
- DTOs use `class-validator`/`class-transformer` decorators plus `@nestjs/swagger` `@ApiProperty` annotations for the generated docs. `main.ts` registers a global `ValidationPipe({ transform: true })`, so those decorators are enforced on every HTTP route — query params still need `@Type(() => Number)` (etc.) to be coerced from strings.
- ESLint has `@typescript-eslint/no-explicit-any` off and `no-floating-promises`/`no-unsafe-argument` set to `warn` (not `error`) — existing code relies on this looseness in places (e.g. `any` request/user types).
