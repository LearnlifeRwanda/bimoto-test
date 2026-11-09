import type { Server as SocketIOServer } from 'socket.io';
import { SOCKET_EVENTS } from '@bimoto/shared';

// The bimoto socket auth (see packages/server/src/socket/index.ts) attaches
// the verified JWT payload onto the socket instance as `socket.user`. Sockets
// also join a `user:${userId}` room on connect (SOCKET-FIX G2), but the
// freeze sweep deliberately keeps walking every authenticated socket rather
// than trusting room membership — disconnecting the wrong sockets is worse
// than an O(N) walk, and the Africa/Kigali pilot is small enough that we
// don't need a directory yet.
export function disconnectUserSockets(
  io: SocketIOServer | null | undefined,
  userId: string,
  reason: string,
): number {
  if (!io) return 0;
  let count = 0;
  try {
    const sockets = io.sockets.sockets;
    for (const [, socket] of sockets) {
      const payload = (socket as any).user as
        | { userId?: string }
        | undefined;
      if (payload?.userId === userId) {
        try {
          socket.emit(SOCKET_EVENTS.ACCOUNT_FROZEN, { reason });
        } catch {
          // emit failures are non-fatal; we still disconnect
        }
        socket.disconnect(true);
        count++;
      }
    }
  } catch (err) {
    console.warn('[ADMIN] socket disconnect sweep failed:', err);
  }
  return count;
}
