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

## Media

- [ ] **Image upload for user and server profile / banner images** — behind an abstract class so the storage backend is swappable (SIRV, GCP bucket, …), with pre-compression and possibly thumbnail generation.
