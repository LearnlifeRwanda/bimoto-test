import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import * as Sentry from '@sentry/node';
import { verifyAccessToken } from '../utils/jwt';
import prisma from '../prisma';
import { SOCKET_EVENTS, DRIVER_LIVENESS_PING_MS } from '@bimoto/shared';

let io: Server;

export interface AuthorisedJourney {
  customerId: string;
  driverId: string | null;
}

export type AuthSocket = Socket & {
  user?: { userId: string; role?: string };
  authorisedJourneys?: Map<string, AuthorisedJourney>;
  /**
   * LOCATION-LIFE A G4 — when this connection last refreshed the
   * sending driver's discovery liveness. In-memory and per-socket: the
   * throttle below is a cost guard, not a correctness boundary, so a
   * reconnect starting fresh is harmless.
   */
  lastLivenessWriteAt?: number;
};

async function loadJourneyParties(journeyId: string): Promise<AuthorisedJourney | null> {
  const j = await prisma.journey.findUnique({
    where: { id: journeyId },
    select: { customerId: true, driverId: true },
  });
  if (!j) return null;
  return { customerId: j.customerId, driverId: j.driverId };
}

export function isJourneyParty(parties: AuthorisedJourney, userId: string): boolean {
  return parties.customerId === userId || parties.driverId === userId;
}

/**
 * LOCATION-LIFE A G4 — a driver who is broadcasting is, self-evidently,
 * alive. Say so where discovery looks.
 *
 * Discovery's whole notion of a live driver is
 * `driverProfile.lastLocationAt`, and seven consumers gate on it. This
 * handler wrote `gpsPoint` and never touched that column, so a motari
 * mid-approach — streaming his position every 8 seconds — went stale
 * for discovery after 300 s and stayed invisible AFTER the drop-off
 * too, until something else happened to write the column. The ride was
 * the very thing that hid him.
 *
 * THROTTLED to the client heartbeat's own cadence: frames arrive every
 * ~8 s (useDriverLocationBroadcast's BROADCAST_INTERVAL_MS), and the
 * freshness window is 300 s, so writing on every frame would roughly
 * double the write cost to buy precision nobody reads.
 *
 * Fire-and-forget with a breadcrumb, exactly the posture of the
 * `gpsPoint` write beside it: liveness must never delay or fail a
 * broadcast.
 */
function refreshDriverLiveness(
  socket: AuthSocket,
  userId: string,
  lat: number,
  lng: number,
  now: Date,
): void {
  const last = socket.lastLivenessWriteAt ?? 0;
  if (now.getTime() - last < DRIVER_LIVENESS_PING_MS) return;
  socket.lastLivenessWriteAt = now.getTime();

  // Secondary to the broadcast in every sense, including this one: the
  // try/catch covers a SYNCHRONOUS throw the way .catch covers a
  // rejection. Liveness is a courtesy to discovery — it must never be
  // able to break the frame the ride itself depends on.
  try {
    prisma.driverProfile
      .updateMany({
        where: { userId },
        data: { lastLocationAt: now, lastLat: lat, lastLng: lng },
      })
      .catch((err) =>
        Sentry.captureException(err, { tags: { src: 'socket-driver-liveness' } }),
      );
  } catch (err) {
    Sentry.captureException(err, { tags: { src: 'socket-driver-liveness' } });
  }
}

/**
 * Install per-connection handlers. Exposed for unit tests.
 */
export function registerSocketHandlers(socket: AuthSocket) {
  socket.authorisedJourneys = new Map();

  // SOCKET-FIX G2 — join the per-user room at connection time. The three
  // io.to(`user:${userId}`) emitters (journey:available in both discovery
  // broadcasters, auto-bid:fired, suggest-up:available) were broadcasting
  // into rooms nothing had ever joined, so their events reached no one
  // regardless of what the client listened for.
  const connectedUserId = socket.user?.userId;
  if (connectedUserId) socket.join(`user:${connectedUserId}`);

  // SOS-WIRE G1 — admin-role sockets additionally join the shared
  // 'admins' room so emergency alerts (emitToAdmins) reach every
  // connected admin session without per-journey membership.
  if (socket.user?.role === 'ADMIN') socket.join('admins');

  socket.on(SOCKET_EVENTS.JOIN_JOURNEY, async ({ journeyId }: { journeyId?: unknown }) => {
    if (!journeyId || typeof journeyId !== 'string') return;
    const userId = socket.user?.userId;
    if (!userId) return;
    try {
      const parties = await loadJourneyParties(journeyId);
      if (!parties || !isJourneyParty(parties, userId)) {
        socket.emit(SOCKET_EVENTS.ERROR, { code: 'unauthorised-journey', journeyId });
        return;
      }
      socket.authorisedJourneys!.set(journeyId, parties);
      socket.join(`journey:${journeyId}`);
    } catch (err) {
      Sentry.captureException(err, { tags: { src: 'socket-join-journey' } });
    }
  });

  socket.on(SOCKET_EVENTS.LEAVE_JOURNEY, ({ journeyId }: { journeyId?: unknown }) => {
    if (!journeyId || typeof journeyId !== 'string') return;
    socket.authorisedJourneys?.delete(journeyId);
    socket.leave(`journey:${journeyId}`);
  });

  // SOS-FOLLOW G4 — the live follow, which exists only inside an
  // emergency and only towards ops.
  //
  // Read the guard clauses before the body: they are the feature. Two
  // independent things must both be true for a frame to be accepted —
  // the sender is a party to that journey, and the journey holds an
  // ACTIVE EmergencyAlert. The first is the same rule UPDATE_LOCATION
  // has always enforced. The second is the whole difference between
  // this and surveillance, and it is re-read from the database on every
  // frame rather than cached on the socket, because an alert that ops
  // just closed has to stop the follow NOW and not at the next
  // reconnect.
  //
  // WHERE IT GOES is the other half. `emitToAdmins`, and nothing else.
  // Not `socket.to(room)` like UPDATE_LOCATION above, not emitToJourney,
  // not emitToUser. A position raised in an emergency reaches the ops
  // room and no other person on earth — least of all the other party to
  // the journey, who in the case that matters most is the reason the
  // button was pressed.
  //
  // A REFUSAL IS SILENT. UPDATE_LOCATION answers an unauthorised frame
  // with SOCKET_EVENTS.ERROR; this one deliberately does not. The phone
  // sending these frames belongs to somebody who pressed a panic button,
  // and an error the app would have to render — or worse, a retry loop —
  // is the last thing that phone should be spending on. The drop leaves
  // a Sentry breadcrumb so it is visible to us and to nobody else.
  //
  // Both participants stream, not only the one who pressed. An emergency
  // on a ride is an emergency for two people and which of them still has
  // a working phone is not knowable in advance.
  socket.on(
    SOCKET_EVENTS.EMERGENCY_LOCATION,
    async (data: { journeyId?: unknown; lat?: unknown; lng?: unknown; accuracy?: unknown }) => {
      const userId = socket.user?.userId;
      if (!userId) return;
      if (!data || typeof data.journeyId !== 'string') return;
      if (typeof data.lat !== 'number' || typeof data.lng !== 'number') return;

      const journeyId = data.journeyId;
      const lat = data.lat;
      const lng = data.lng;
      const accuracy = typeof data.accuracy === 'number' ? data.accuracy : null;

      try {
        const parties = await loadJourneyParties(journeyId);
        if (!parties || !isJourneyParty(parties, userId)) {
          Sentry.addBreadcrumb({
            category: 'emergency-follow',
            level: 'warning',
            message: 'dropped follow frame: sender is not a party to this journey',
            data: { journeyId, userId },
          });
          return;
        }

        const alert = await prisma.emergencyAlert.findFirst({
          where: { journeyId, status: 'ACTIVE' },
          select: { id: true },
        });
        if (!alert) {
          Sentry.addBreadcrumb({
            category: 'emergency-follow',
            level: 'info',
            message: 'dropped follow frame: journey holds no ACTIVE alert',
            data: { journeyId, userId },
          });
          return;
        }

        const timestamp = new Date();

        // The same fire-and-forget write UPDATE_LOCATION uses: the relay
        // must not wait on the DB. These points are GpsPoints like any
        // other, which is why the retention hold on an ACTIVE alert
        // (gps-retention.job.ts) is what keeps the follow's own trail
        // readable afterwards.
        prisma.gpsPoint
          .create({ data: { journeyId, lat, lng, accuracy, timestamp } })
          .catch((err) =>
            Sentry.captureException(err, { tags: { src: 'socket-emergency-location' } }),
          );

        emitToAdmins(SOCKET_EVENTS.EMERGENCY_LOCATION_UPDATE, {
          alertId: alert.id,
          journeyId,
          userId,
          role: parties.customerId === userId ? 'CUSTOMER' : 'DRIVER',
          lat,
          lng,
          accuracy,
          at: timestamp.toISOString(),
        });
      } catch (err) {
        // A lookup that fails drops the frame like any other refusal.
        // The next frame is five seconds away.
        Sentry.captureException(err, { tags: { src: 'socket-emergency-location' } });
      }
    },
  );

  socket.on(SOCKET_EVENTS.UPDATE_LOCATION, (data: { lat?: unknown; lng?: unknown; accuracy?: unknown }) => {
    const userId = socket.user?.userId;
    if (!userId || !data || typeof data.lat !== 'number' || typeof data.lng !== 'number') return;
    const lat = data.lat;
    const lng = data.lng;
    const accuracy = typeof data.accuracy === 'number' ? data.accuracy : null;

    // LOCATION-LIFE A G4 — refresh discovery liveness once per frame,
    // not once per room, and only for the DRIVER of the journey. The
    // identity is unambiguous without new auth logic: the authorised
    // parties already carry driverId, and the room guard below is what
    // established them. A customer sharing their position (the
    // emergency and approach paths) never matches, and so never writes
    // to a driver profile.
    let livenessRefreshed = false;

    for (const room of socket.rooms) {
      if (!room.startsWith('journey:')) continue;
      const journeyId = room.split(':')[1];
      const parties = socket.authorisedJourneys?.get(journeyId);
      if (!parties || !isJourneyParty(parties, userId)) {
        socket.emit(SOCKET_EVENTS.ERROR, { code: 'unauthorised-journey', journeyId });
        continue;
      }

      const timestamp = new Date();

      if (!livenessRefreshed && parties.driverId === userId) {
        livenessRefreshed = true;
        refreshDriverLiveness(socket, userId, lat, lng, timestamp);
      }

      // Fire-and-forget. The broadcast must NOT wait on the DB write.
      prisma.gpsPoint
        .create({
          data: {
            journeyId,
            lat,
            lng,
            accuracy,
            timestamp,
          },
        })
        .catch((err) =>
          Sentry.captureException(err, { tags: { src: 'socket-update-location' } }),
        );

      socket.to(room).emit(SOCKET_EVENTS.DRIVER_LOCATION, {
        journeyId,
        lat,
        lng,
        accuracy,
        timestamp: timestamp.toISOString(),
      });
    }
  });
}

export function initSocket(httpServer: HttpServer) {
  io = new Server(httpServer, {
    cors: { origin: process.env.CLIENT_URL || 'http://localhost:5173', credentials: true },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) return next(new Error('Authentication required'));
    try {
      const payload = verifyAccessToken(token as string);
      (socket as AuthSocket).user = payload;
      next();
    } catch { next(new Error('Invalid token')); }
  });

  io.on('connection', (socket) => registerSocketHandlers(socket as AuthSocket));

  return io;
}

export function getIO(): Server {
  if (!io) throw new Error('Socket.io not initialized');
  return io;
}

export function emitToJourney(journeyId: string, event: string, data: any) {
  if (io) io.to(`journey:${journeyId}`).emit(event, data);
}

// SOS-WIRE G1 — broadcast to every connected admin-role socket (they
// join the 'admins' room at connect). Same no-io guard as emitToJourney
// so test environments without an initialized server are a no-op.
export function emitToAdmins(event: string, data: any) {
  if (io) io.to('admins').emit(event, data);
}

// LIVE-WIRE G2 — address one user directly, wherever they are standing.
//
// The journey room is the wrong envelope for anything a BIDDING driver
// must hear: `loadJourneyParties` authorises only customerId and
// driverId, and a REQUESTED journey has no driverId, so a driver who
// has bid is refused the room (measured 10/10 in
// docs/live-wire-measurements.md). The per-user room he DOES hold is
// joined at connect (`user:${userId}`, see registerSocketHandlers) and
// is already the envelope the discovery cascade uses for
// journey:available — this is that same channel, not a new one.
export function emitToUser(userId: string, event: string, data: any) {
  if (io) io.to(`user:${userId}`).emit(event, data);
}
