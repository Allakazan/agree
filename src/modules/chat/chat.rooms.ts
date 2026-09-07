// Socket.IO room names. Rooms are implicit — emitting to one nobody joined is
// a no-op, so these only decide *where* a payload can land; who joins is
// decided by ChatGateway (user rooms at handshake, channel rooms on subscribe).
export const channelRoom = (channelId: string) => `channel:${channelId}`;

export const userRoom = (userId: string) => `user:${userId}`;
