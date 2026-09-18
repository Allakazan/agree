# Voice channels — WebRTC implementation plan

## Context

`ChannelType.VOICE` exists in [channel.schema.ts](../src/modules/server/schemas/channel.schema.ts) and is seeded, but nothing reads it — voice channels are inert. We want users to talk, and later share webcam and screen, inside those channels.

The target deployment is **GCP Cloud Run**, and that single fact rules out most of the WebRTC design space:

| Cloud Run constraint | Consequence |
| --- | --- |
| Only HTTP/1.1, HTTP/2, gRPC, WebSockets over TLS — **no UDP, no raw TCP** | A self-hosted SFU (mediasoup, LiveKit) is **impossible**. Media never transits our server. |
| Exactly **one** exposed port (`$PORT`) | Every gateway must attach to the Nest HTTP server (done in Phase 0.1) — a second listener is unreachable in production. |
| Request cap of 60 minutes; an open WebSocket *is* a request | Voice calls are severed at 60 min. Clients must reconnect and re-join. |
| Idle socket still bills CPU and blocks scale-to-zero | A user parked in a voice channel costs money. Presence must be cheap. |

So Nest carries **signaling only**. Media goes either browser↔browser (mesh) or through **Cloudflare Realtime**, which is serverless and needs no VM.

**Outcome:** a `voice` module that owns join/leave/presence/signaling, ships in Phase 1 as pure P2P mesh audio, and grows into video + screenshare on Cloudflare's SFU in Phase 2 without rewriting its auth, presence, or room logic.

---

## Topology decision

One topology **per room**, not per media kind. Two independent thresholds would put audio on mesh and video on the SFU simultaneously — two transports, broken A/V sync, double the state.

```ts
const useSfu =
  participants > VOICE_MESH_MAX ||   // default 5
  hasVideoPublisher;                 // video never runs on the mesh
```

Video has no mesh threshold of its own. An earlier draft had `VIDEO_MESH_MAX = 2` (a 1:1 video call staying P2P), but adding video to an already-open mesh connection means the peer who was *already there* has to renegotiate — which breaks the "newcomer offers, existing peers only answer" rule and drags perfect negotiation (polite/impolite peers, rollback) into the client. So the first video publisher promotes the whole room, and the mesh stays audio-only.

**Promotion is one-way.** A room that goes SFU stays SFU until it empties. Without this, a room oscillating at the threshold (5↔6 people) renegotiates every join/leave, and every transition is an audible glitch. One-way promotion also deletes the harder half of the migration state machine.

Both limits come from env vars via a new `src/config/voice.ts`, following the [auth.ts](../src/config/auth.ts) factory pattern.

### Why mesh is genuinely correct for Phase 1

Mesh collapses under *video*, not audio. Opus is ~40 kbps; a 6-person mesh means 5 upstreams ≈ 200 kbps — fine on any connection. Cost math on Cloudflare's 1000 GB/mo free tier (shared between SFU **and** TURN — not two separate allowances):

| Scenario | Egress | Free tier lasts |
| --- | --- | --- |
| Voice, 6 people, SFU | 0.54 GB/h | ~1850 h/mo |
| Voice, 10 people, SFU | 1.62 GB/h | ~617 h/mo |
| Screenshare 1080p, 5 viewers | 7.9 GB/h | **~127 h/mo** |
| Same, with simulcast (720p/360p mix) | 2.4 GB/h | ~420 h/mo |

Voice never threatens the free tier. **100% of the simulcast saving lives in video/screenshare**, which is why it belongs to Phase 2 and not here.

---

## What already exists and gets reused

The socket foundation landed in `9ff92e3` and is in good shape. Do **not** rebuild any of this:

| Piece | Location | Use in voice |
| --- | --- | --- |
| `WsAuthService.authenticate(client)` | [ws-auth.service.ts](../src/modules/auth/ws-auth.service.ts) | Handshake auth in `handleConnection`. Never throws — returns `null` for anonymous. |
| Room-name helpers | [chat.rooms.ts](../src/modules/chat/chat.rooms.ts) | Mirror as `voice.rooms.ts`. Never build room names inline. |
| `ServerService.findChannelForMember` | [server.service.ts](../src/modules/server/server.service.ts) | The membership gate on join — returns the channel so `type` can be checked too. |
| `WsValidationPipe` | [ws-validation.pipe.ts](../src/common/pipes/ws-validation.pipe.ts) | On `@MessageBody()` only — never `@UsePipes` (it would run against `@ConnectedSocket()` and throw). |
| `WsGlobalExceptionFilter` | [ws-exception.filter.ts](../src/common/filters/ws-exception.filter.ts) | Only unwraps `BadRequestException`/`WsException` — throw those, not `ForbiddenException`. |
| `@User()` decorator | [user.decorator.ts](../src/modules/auth/decorators/user.decorator.ts) | Reads `socket.data.user`. |
| `@IsObjectID()` | [isObjectID.ts](../src/common/decorators/isObjectID.ts) | Validating `channelId` in DTOs. |

`AuthModule` does not export `AuthGuard`, so `VoiceModule` must re-provide it locally — same as [chat.module.ts:14](../src/modules/chat/chat.module.ts#L14).

## Gaps to fill

1. **No `OnGatewayDisconnect` anywhere in the codebase.** Text chat doesn't need it; voice presence is meaningless without it (tab close = ghost user in the channel forever).
2. ~~**Nothing ever checks `channel.type`.**~~ — done in Phase 0.2; `findChannelForMember` returns the matched channel, so the voice gateway can reject `type !== VOICE`.
3. ~~**Port `4040` is hardcoded** in the gateway decorator~~ — done in Phase 0.1; both gateways now share `$PORT`.

---

## Phase 0 — prerequisites

**0.1 Move gateways onto the main HTTP port.** ✅ **Done.**
`@WebSocketGateway(4040, {…})` → `@WebSocketGateway({…})` in [chat.gateway.ts](../src/modules/chat/chat.gateway.ts), so it attaches to the Nest HTTP server on `$PORT`. The CORS block now lives in [src/common/cors.ts](../src/common/cors.ts) — one `ORIGIN`-driven origin list feeding both `wsCorsOptions` (import it in `voice.gateway.ts` too) and the REST `httpCorsOptions` in `main.ts`, which previously used `origin: '*'`. `ORIGIN` is documented in `.env.example` and the README.

The two gateways then live on distinct namespaces (`chat`, `voice`) over the **same** TCP connection — the socket.io client reuses one `Manager` per URL, so this costs the browser nothing.

**0.2 Add a channel-returning lookup to `ServerService`.** ✅ **Done.**

```ts
async findChannelForMember(
  userId: string,
  channelId: string,
): Promise<Channel | null>
```

Projects `{ _id: 1, 'channels.$': 1 }` so one query returns the matched channel; the membership half reuses `usersService.isMemberOfServer`. The voice gateway rejects `type !== VOICE` and non-members in a single round trip. `null` covers a malformed id, an unknown channel, and a non-member alike — the caller never learns which, so a non-member can't probe for channel existence. `isUserMemberOfChannelServer` is unchanged; chat still uses it. The id parse both share now lives in [`src/common/objectid.ts`](../src/common/objectid.ts) as `toObjectId` — `new Types.ObjectId(…)` throws on malformed input and every caller here wants a miss instead.

---

## Phase 1 — voice over P2P mesh

### Layout

Mirrors the module convention in `CLAUDE.md` (`*.module.ts`, `*.gateway.ts`, `*.service.ts`, `dto/`):

```
src/modules/voice/
├── voice.module.ts
├── voice.gateway.ts              # namespace 'voice' — signaling + presence lifecycle
├── voice.controller.ts           # GET /voice/:channelId/participants
├── voice.rooms.ts                # voiceRoom(channelId) = `voice:${channelId}`
├── voice.presence.service.ts     # in-memory Map implementing the store interface
├── voice.presence.interface.ts   # VoicePresenceStore — the Redis seam
├── voice.topology.service.ts     # mesh vs SFU decision + bitrate policy
├── voice.ice.service.ts          # Cloudflare TURN credential minting (cached)
├── types/voice.types.ts          # VoiceParticipant, VoiceState, Topology
└── dto/
    ├── voice-join.dto.ts
    ├── voice-signal.dto.ts
    └── voice-state.dto.ts
```

### Signaling protocol

Client → server:

| Event | Payload | Behaviour |
| --- | --- | --- |
| `voice:join` | `{ channelId }` | `findChannelForMember` → must exist, be `VOICE`, user must be a member. Joins the room, records presence. **Acks** with `{ selfId, topology, participants[], iceServers, bitrate }`. Broadcasts `voice:peer-joined` to the rest. |
| `voice:leave` | `{ channelId }` | Leaves room, drops presence, broadcasts `voice:peer-left`. |
| `voice:signal` | `{ channelId, targetUserId, kind: 'offer'\|'answer'\|'candidate', payload }` | Relay only. Rejects unless **both** sender and target are in `voice:<channelId>`. Emits to the target's user room. |
| `voice:state` | `{ channelId, muted, deafened }` | Broadcasts `voice:state-changed`. Server stores it so late joiners see correct mute icons. |

Server → client: `voice:peer-joined`, `voice:peer-left`, `voice:signal`, `voice:state-changed`.

**Glare avoidance:** the **newcomer** creates an offer to every existing participant; existing peers only ever answer. No simultaneous-offer race, no rollback logic.

**Authorization mirrors the chat rule:** presence in `voice:<channelId>` *is* the authorization. The membership check happens in exactly one place (`voice:join`); every other handler asserts room membership via `client.rooms.has(...)` and never calls `join()`. Consistent with the existing `[[explicit-authorization-gates]]` rule — no self-healing joins on the signal path.

### Presence

`VoicePresenceStore` is a small interface (`add`, `remove`, `removeSocket`, `listByChannel`, `countByChannel`, `setState`) with an in-memory `Map` implementation. Keying rules:

- Keyed by **socketId**, not userId — a user with two tabs has two sockets.
- A user is "left" only when their **last** socket for that channel goes.
- **One active voice socket per user per channel**: a second `voice:join` from the same user disconnects the first (Discord's behaviour). Prevents self-echo.

`handleDisconnect` sweeps every voice room the socket was in and broadcasts `voice:peer-left`. This also covers the Cloud Run 60-minute cut: the socket dies, presence is cleaned, and the client's reconnect issues a fresh `voice:join`.

The interface is the Redis seam. Single-instance today; swapping in Redis + `@socket.io/redis-adapter` later is one new implementation and a provider swap, not a refactor.

### ICE / TURN

`voice.ice.service.ts` mints short-lived credentials from Cloudflare Realtime TURN:

```
POST https://rtc.live.cloudflare.com/v1/turn/keys/$TURN_KEY_ID/credentials/generate-ice-servers
Authorization: Bearer $TURN_KEY_API_TOKEN
{ "ttl": 3600 }
→ 201 { "iceServers": [ { urls: [stun…] }, { urls: [turn…], username, credential } ] }
```

No official npm package — plain `fetch`. Cache the response until shortly before `ttl` expiry rather than calling per join; credentials are per-key, not per-user. The `iceServers` array goes straight into the `voice:join` ack and into the browser's `RTCPeerConnection` config.

Relayed (TURN) traffic bills against the **same** 1000 GB allowance as the SFU. Roughly 15–20% of users behind symmetric NAT will need it.

### Bitrate policy

The server **cannot enforce** bitrate — `maxBitrate` is applied client-side by `RTCRtpSender.setParameters()`. SDP munging (`b=AS:`) is fragile and not worth it. So the server ships a *policy* in the join ack and trusts the client:

```ts
{ audio: { maxBitrate: 40_000 } }   // Opus, mono
```

In mesh, scale the ceiling with room size: `min(base, uplinkBudget / (peers - 1))`.

Note that **adaptive bitrate is not something we implement** — WebRTC's GCC/TWCC already adapts continuously. We set a ceiling and let libwebrtc find the floor. Simulcast likewise has no value in mesh: each `RTCPeerConnection` is independent, so the sender already encodes per-receiver. Both are Phase 2, SFU-only concerns.

### Tests

Follow the pattern in `chat.gateway.spec.ts`: `.overrideGuard(AuthGuard).useValue({ canActivate: () => true })` and assign `gateway.server = { to: () => ({ emit }) } as never`. Cover: join rejects a TEXT channel; join rejects a non-member; signal rejects a target outside the room; disconnect broadcasts `peer-left` and clears presence; second join from the same user evicts the first socket.

---

## Phase 2 — video, screenshare, and the Cloudflare SFU ✅ Done

Phase 1's gateway, presence, rooms, and auth are unchanged. Everything below is **off unless `CF_REALTIME_APP_ID` and `CF_REALTIME_APP_SECRET` are both set** — without them the module behaves exactly as in Phase 1 (audio-only mesh, room full at `VOICE_MESH_MAX`), which is what lets the backend ship before the client does.

API checked against Cloudflare's OpenAPI (`realtime-api-2024-05-21.yaml`): `https://rtc.live.cloudflare.com/v1/apps/{appId}`, `Authorization: Bearer <appSecret>`, endpoints `sessions/new`, `sessions/{id}/tracks/new` (push = `location: 'local'`, pull = `location: 'remote'` + `sessionId` + `trackName`), `renegotiate`, `tracks/close` and `tracks/update`. Errors come back at the top level **and per track**, with HTTP 200 — a status check alone misses them.

### The secret never leaves the server

Every SFU call is proxied through the gateway; the app secret lives only in `CloudflareSfuClient`. That is what makes the SFU authorizable at all — a client holding the secret could open sessions and pull any track in the app directly.

- A participant's Cloudflare `sessionId` is stored in presence **beside** the `VoiceParticipant`, never on it (`VoiceSfuState`), so nothing that broadcasts a participant can leak it. Clients never send one either.
- A pull names a publisher by **user id** and a track by **name**; the server resolves the publisher through presence, the same way `voice:signal` resolves `targetUserId`. Presence in the room remains the authorization: you can only pull from someone in `voice:<channelId>`.
- `trackName` is server-chosen (= the source: `mic`, `camera`, `screen`, `screen-audio`), one track per source per participant.
- The membership gate stays on `voice:join` alone; every SFU handler asserts room membership and never calls `join()`.

### Layout

| File | Role |
| --- | --- |
| `voice.sfu.client.ts` | `CloudflareSfuClient` — one method per endpoint, plain `fetch`, no policy. **Throws** (unlike `VoiceIceService`): a failed publish has no degraded mode. |
| `voice.sfu.service.ts` | `VoiceSfuService` — authorizes pulls through presence, opens sessions lazily, dedupes pulls, validates publishes, serializes each socket's calls. Cloudflare errors reach the client as one generic message; the detail goes to the log. |
| `voice.sdp.ts` | Read-only SDP inspection for publish offers. |
| `voice.simulcast.ts` | The codec allowlist and the simulcast ladders — a policy table, not env knobs. |

Calls for one socket are serialized (a promise chain per socket): each operation is a read-modify-write of that socket's SFU state around an HTTP call, and a publish and a pull fired together would otherwise each write back a state missing the other's mids. Per-process, like presence.

### Protocol

Client → server, all acked, all behind `assertInRoom`:

| Event | Payload | Behaviour |
| --- | --- | --- |
| `voice:sfu:publish` | `{ channelId, sessionDescription: offer, tracks: [{ mid, source, contentHint? }] }` | Validates the offer, opens the session lazily, `tracks/new` local, records the tracks, broadcasts `voice:track-published`. On a mesh room with video it **promotes** the room — after the Cloudflare call, so a refused publish leaves the room on the mesh. An audio-only publish on a mesh room is refused. |
| `voice:sfu:pull` | `{ channelId, tracks: [{ userId, trackName, preferredRid? }] }` | Batched (≤ 64, Cloudflare's per-call limit). Refuses your own track, a publisher not in the room, a track not published, a track already pulled, a layer the track lacks. Video defaults to the **cheapest** layer. Acks Cloudflare's offer. |
| `voice:sfu:renegotiate` | `{ channelId, sessionDescription: answer }` | Completes a negotiation Cloudflare started. |
| `voice:sfu:close` | `{ channelId, mids[] }` | Closes mids on the caller's own session, pulled and published alike. Published ones are unpublished (`voice:track-unpublished`). **No offer, no renegotiation**: Cloudflare gets `{ tracks, force: true }` and the client leaves the transceiver in place, dead. See "Why the close never renegotiates" below. Checked against the live API, which disagrees with its OpenAPI: `force` is **required** (without it: `400 decoding_error ... force`), `force: false` needs the offer (`406 sessionDescription must be present`), and `force: true` alone passes. |
| `voice:sfu:layer` | `{ channelId, mid, preferredRid }` | `tracks/update` on a pulled video track. |

Server → client: `voice:topology-changed { channelId, topology: 'sfu' }`, `voice:track-published { channelId, userId, track }`, `voice:track-unpublished { channelId, userId, trackName }`.

Changes to Phase 1 events: `voice:join` past `meshMax` now promotes instead of refusing (the ack says `topology: 'sfu'`; existing members get `topology-changed`), capped at `VOICE_SFU_MAX`; participants carry `tracks`; the ack carries `video` (`null` without an SFU). `voice:signal` is refused in an `sfu` room, so a mesh-only client cannot keep running P2P past the limit.

`leave`, `disconnect` and eviction make **no Cloudflare calls**: presence drops the session and tracks, `peer-left` tells pullers to close theirs, and Cloudflare garbage-collects a track 30 s after its packets stop. A publisher nobody pulls costs no egress. `handleDisconnect` stays free of outside I/O.

### Why the close never renegotiates

A close used to carry the client's offer (`force: false`). That offer is the one place a client sends an m-section with **port 0** — what `transceiver.stop()` generates — and a rejected m-section frees its slot for **m-line recycling**. Cloudflare then reuses that mid on its next offer (always a pull), and numbers the `a=extmap` header-extension ids from scratch, because its own answer to the close came back with no `a=extmap` at all. Chrome keeps the extension map **per mid** for the life of the `RTCPeerConnection` and refuses the remap:

```
Failed to set remote offer sdp: RTP extension ID reassignment not supported
(collision on active MID 2, id=1, old_uri="urn:ietf:params:rtp-hdrext:sdes:rtp-stream-id",
new_uri="http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01")
```

It poisons the whole PC, not just that exchange: every later negotiation throws the same error, `createOffer` included, so the client cannot even close its way out. Reopening a screenshare hit it every time — the first live worked, the second one killed the puller's session until it rejoined.

So the rule is **nobody ever offers port 0**: the close sends no offer (`force: true`), and the client retires a transceiver with `replaceTrack(null)` + `direction = 'inactive'` instead of `stop()`, which keeps the slot occupied in every later offer. No slot ever frees, so no mid is ever recycled, so renumbering has nothing to collide with — Cloudflare can only append a fresh mid, which carries no prior map. The cost is one dead m-section per closed track: no encoder, no egress, a few hundred bytes of SDP. If Cloudflare reuses one of those transceivers for a later pull, the client takes the track off the receiver (`ontrack` does not fire again).

The alternative on the table was splitting send and receive into two `RTCPeerConnection`s (and two Cloudflare sessions), so that each PC only ever has one offerer. That removes the same collision, but it costs two session ids per socket and a mid keyspace per PC — `published` and `pulled` could no longer share one map, since both PCs number mids from 0.

### Migration

On `voice:topology-changed` a client closes its mesh `RTCPeerConnection`s, opens **one** PC for the SFU (or reuses it, if it was the video publisher that triggered the promotion), publishes its mic and pulls what the roster shows, converging afterwards through `track-published`. One-way only (see above), so there is no demotion path to write. A client must serialize negotiations on that PC — publish, pull and close each complete before the next.

### What the server can and cannot enforce

| | Decided by | The server can… |
| --- | --- | --- |
| Send bitrate | The browser (`sendEncodings` / `setParameters`) | **Publish** a ceiling. Not verify it: `maxBitrate` never reaches the SDP, and Cloudflare enforces no bitrate cap. A modified client can ignore it. |
| Egress — the bill | The server | **Enforce**: which layer each puller gets, one pull per publisher track, and `VOICE_SFU_MAX` per room. |
| Codec | The client offers (narrowed with `setCodecPreferences`); Cloudflare answers from the offer | **Validate**: publish offers pass through the server anyway. |

The publish offer is inspected, never rewritten (no munging, as in Phase 1). For each declared `mid` the matching m-section must: be the right kind (`audio` for `mic`/`screen-audio`, `video` for `camera`/`screen`); carry **only** allowed primary codecs — VP8 for video, Opus for audio, with `rtx`/`red`/`ulpfec`/`flexfec`/CN/DTMF ignored — which leaves Cloudflare's answer no other choice; and, for video, declare in `a=simulcast:send` exactly the rids of its ladder. Cloudflare itself takes H264/H265/VP8/VP9/AV1 and Opus/G.711; VP8 is our choice because its simulcast works in every browser, while VP9 and AV1 lean on SVC and are costly to encode.

### Simulcast

Supported by Cloudflare, with automatic bandwidth-based layer switching *and* manual control when pulling (`preferredRid`, `priorityOrdering`, `ridNotAvailable`). Cloudflare does **not** mandate rid names; we use `f` / `h` / `q` because under `asciibetical` ordering `a` is the most desirable, so those names sort best-first. Pulls ask for `asciibetical` on both options: downshift on congestion, fall back when a layer disappears.

Ladders differ by `MediaStreamTrack.contentHint`, because a shared spreadsheet and a shared game want opposite tradeoffs:

| Source | `contentHint` | Layers |
| --- | --- | --- |
| Screenshare, text/code | `'detail'` | `f` 1080p15 ≈2.0 Mbps · `h` 720p15 ≈0.8 Mbps |
| Screenshare, video/game | `'motion'` | `f` 1080p30 ≈3.0 · `h` 720p30 ≈1.2 · `q` 540p30 ≈0.5 |
| Webcam | `'motion'` | `f` 720p30 ≈1.2 · `h` 360p30 ≈0.5 · `q` 180p15 ≈0.15 |

Only two layers for text screenshare on purpose: a 360p share of code is unreadable, so that layer would be pure wasted egress — and the publish check refuses an offer that declares it. The join ack ships these as `video.profiles` (capture constraints plus `sendEncodings`-ready layers). The client picks `preferredRid` from the tile's rendered size and lets Cloudflare downshift on congestion. On the SFU the audio ceiling no longer divides the uplink: a sender uploads once whatever the room size.

---

## Env vars

Add to `.env.example` and a new `src/config/voice.ts` (`ORIGIN` is already documented, from Phase 0.1):

```
VOICE_MESH_MAX=5             # > this many participants ⇒ SFU (or refused, without one)
VOICE_SFU_MAX=25             # hard cap on a room once it is on the SFU
VOICE_MAX_AUDIO_BITRATE=40000
CF_TURN_KEY_ID=
CF_TURN_KEY_API_TOKEN=
CF_REALTIME_APP_ID=          # Phase 2 (SFU) — both or neither
CF_REALTIME_APP_SECRET=      # Phase 2 (SFU) — never leaves the server
```

Register it in `app.module.ts` as `load: [database, auth, voice]`.

## Verification

1. `yarn test` — unit specs above.
2. `docker-compose up -d && yarn start:dev`, then two browser tabs with different accounts against a seeded `VOICE` channel: both join, audio flows, mute propagates, closing one tab fires `peer-left` within a second.
3. Force TURN by setting `iceTransportPolicy: 'relay'` in the client `RTCPeerConnection` config — proves Cloudflare credentials work, not just host candidates on localhost.
4. Confirm a `TEXT` channel is rejected by `voice:join`, and that a non-member of the server is rejected.
5. Confirm `/voice` connects over `$PORT` like `/chat` does — the voice gateway must carry no port argument, and its `cors` must come from `src/common/cors.ts`.

## Open decisions

- **Should voice presence be visible to users not in the channel?** Discord shows who's in a voice channel to the whole server. That needs presence broadcast to a server-wide room, which we don't have yet — deferred, but it affects whether presence eventually must be Redis-backed sooner than Phase 2.
- **Speaking indicator** — client-side audio-level detection broadcast over `voice:state`, or skipped in Phase 1? It's cheap on the client but chatty on the socket; probably throttle to ~4 Hz if included.
