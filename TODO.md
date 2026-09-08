# TODO

Backlog, roughly in the order we'll pick them up. One at a time.

## Chat

- [x] **List DM / group messages over REST** — `GET /chat/conversations` and `GET /chat/conversations/:conversationId`, both paginated with `limit`/`before`.
- [ ] **Membership check on `GET /chat/:channelId`** — the read path is still authenticated-only; any logged-in user can read any channel's history.
- [ ] **Authorization on DM sends** — `findOrCreateDirectConversation` only validates that the recipient ids exist, so anyone can inject into any `recipientIds` combination.
- [ ] **Persist the sender's avatar on the message row** — `messages.senderAvatarUrl` is written as `''` today.

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
