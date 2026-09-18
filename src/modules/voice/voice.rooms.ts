// Socket.IO room names for the `voice` namespace. Never build these inline —
// presence in `voice:<channelId>` *is* the authorization for every handler
// after `voice:join`, so the name has to come from one place.
//
// Rooms are scoped per namespace: `voice:<id>` here is a different room from an
// identically named one in the `chat` namespace, and neither gateway can reach
// into the other's rooms. That is why voice keeps its own helper instead of
// importing `chat.rooms.ts`.
export const voiceRoom = (channelId: string) => `voice:${channelId}`;

/**
 * Where server-wide presence goes. A socket in `server:<serverId>` is only
 * *watching* — it has no voice presence and no say on the signal path, so
 * joining it never grants what `voice:<channelId>` does.
 */
export const serverRoom = (serverId: string) => `server:${serverId}`;
