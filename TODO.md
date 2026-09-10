# TODO

Backlog, roughly in the order we'll pick them up. One at a time.

## Auth

The cookie session landed in `3a31485`; these are the loose ends it left. The first one
blocks the first cross-origin deploy, so it sits at the top of the list.

- [ ] **`sameSite` must be `none` in production** — `setTokenCookie` hardcodes `'lax'` (`src/modules/auth/token-cookie.ts`), and a browser withholds a `lax` cookie on every cross-site request: `fetch` with `credentials: 'include'`, and the socket.io handshake alike. It only works today because dev serves front and back from `localhost`. With the API on Cloud Run and `agree-app` on its own domain, every request arrives anonymous. Needs `sameSite: 'none'` + `secure: true` there, driven by config rather than the bare `process.env.NODE_ENV` read the `secure` flag does now.
- [ ] **CSRF protection, before `sameSite: 'none'` ships** — `Authorization: Bearer` was CSRF-proof by construction; a cookie is not. `lax` is what protects the mutation routes today (it blocks cross-site POST), and the item above deliberately removes that. Whatever replaces it — a CSRF token, or an `Origin` check against `corsOrigins` in `src/common/cors.ts` — has to land in the same change, not after it.
- [ ] **Single source for the cookie name** — `src/modules/auth/utils/ws-token.ts` hardcodes `'agree_token='` while `token-cookie.ts` exports `TOKEN_COOKIE`. Nothing imports the constant, and neither file would import the other into a cycle. Renaming it breaks authentication silently: the guard finds no token and answers 401. Worth folding the duplicated `7d` (cookie `maxAge` vs. the JWT `expiresIn` in `auth.module.ts`) into the same pass.

## Chat

- [x] **List DM / group messages over REST** — `GET /chat/conversations` and `GET /chat/conversations/:conversationId`, both paginated with `limit`/`before`.
- [ ] **Membership check on `GET /chat/:channelId`** — the read path is still authenticated-only; any logged-in user can read any channel's history.
- [ ] **Authorization on DM sends** — `findOrCreateDirectConversation` only validates that the recipient ids exist, so anyone can inject into any `recipientIds` combination.
- [ ] **Persist the sender's avatar on the message row** — `messages.senderAvatarUrl` is written as `''` today.
- [ ] **Cache message queries per channel / DM in Redis** — every history read hits Postgres (`ChatService.findAll`, plus the conversation lookup `findAllByChannel`/`findAllByConversation` do first), and the first page of a channel is exactly the query every client re-runs on each page load. Cache keyed by conversation id + `limit`/`before`, invalidated on write in `createMessagesAndConversation` (the same place `lastMessageAt` is bumped) so a cached page can't outlive the message it precedes. Redis is already in `docker-compose.yml`; this and **Online status via Redis** should agree on one connection/module rather than each opening its own.

## Real-time

- [ ] **Online status via Redis** — Redis is up in `docker-compose.yml` but nothing uses it yet.
- [ ] **User notifications over the `user:` room** — needs a message-kind enum in the payload so the client can tell what it's receiving (probably worth applying to channel rooms too).

## Voice

Full design in [`docs/voice-webrtc.md`](docs/voice-webrtc.md). P2P mesh first, Cloudflare
Realtime SFU once a room outgrows it — Cloud Run allows no UDP, so we can never host an SFU
ourselves.

- [x] **Move the gateways off port `4040`** — `@WebSocketGateway()` now takes no port, so `/chat` rides the Nest HTTP server on `$PORT`. REST and WS share one `ORIGIN`-driven CORS config in `src/common/cors.ts`; `ORIGIN` documented in `.env.example` and the README.
- [x] **`ServerService.findChannelForMember`** — projects `{ _id: 1, 'channels.$': 1 }`, so one query returns the matched channel and the caller can check `type`. Returns `null` for a malformed id, an unknown channel, or a non-member. `isUserMemberOfChannelServer` is untouched; both now parse the id through `toObjectId` in `src/common/objectid.ts`.
- [ ] **Voice module, P2P mesh** — `voice` namespace, presence keyed by socket behind a Redis-swappable interface, Cloudflare TURN credentials, membership gate only on `voice:join`.
- [ ] **`OnGatewayDisconnect`** — nothing in the codebase implements it. Without it a closed tab leaves a ghost in the channel forever, and Cloud Run's 60-minute request cap makes that routine rather than rare.
- [ ] **Webcam / screenshare over the Cloudflare SFU** — with simulcast ladders split by `contentHint`, since text and motion want opposite tradeoffs. This is where the bandwidth bill actually lives; voice never approaches the free tier.

## Media

- [ ] **Image upload for user and server profile / banner images** — behind an abstract class so the storage backend is swappable (SIRV, GCP bucket, …), with pre-compression and possibly thumbnail generation.
