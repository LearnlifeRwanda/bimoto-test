// SERVICES/DISCOVERY/URGENT-BROADCAST.TS
//
// R3-T — single-shot fan-out for URGENT_MESSENGER journeys. Mirrors
// supply-broadcast.broadcastToRingDrivers but synchronous (no
// scheduled ring expansion): the entire eligible driver set at the
// final cascade ring receives a socket notification at journey
// creation. There is no t+30s, t+60s rollout — that would defeat
// the purpose of an urgent dispatch.
//
// The journey-feed cascade filter (feed-filter.filterJourneysByCascade)
// also short-circuits to the urgent ring for type=URGENT_MESSENGER, so
// drivers polling their feed see urgent journeys at max radius even
// if the live socket nudge was missed (server restart, transient
// disconnect, etc.).

import type { Server as SocketIOServer } from 'socket.io';
import type { PrismaClient } from '@prisma/client';
import { currentRingForUrgent, haversineMeters } from './cascade';
import { tierForCoordinates } from '../mobility/tier-classification';
import {
  DRIVER_LOCATION_FRESHNESS_SECONDS,
  RING_NO_LIMIT,
} from './config';
import { evaluateAutoBidsForRingDrivers } from '../auto-bid/cascade-integration';
import { SOCKET_EVENTS } from '@bimoto/shared';

const METERS_PER_DEG_LAT = 111_320;

function metersToDegLng(meters: number, lat: number): number {
  const cos = Math.max(0.01, Math.cos((lat * Math.PI) / 180));
  return meters / (METERS_PER_DEG_LAT * cos);
}

export interface UrgentBroadcastOpts {
  prisma: PrismaClient;
  io: SocketIOServer | null;
  journeyId: string;
  pickup: { lat: number; lng: number };
  now?: Date;
}

/**
 * R3-T — fan a journey:available socket event to every fresh,
 * online, non-frozen driver inside the maximum cascade radius for
 * the pickup tier. Returns the list of notified driver userIds.
 *
 * Graceful degradation: when io is null (test harness, socket not
 * initialised), the function still selects candidates and triggers
 * the K2 auto-bid evaluator. The journey is still discoverable via
 * the feed-poll path because feed-filter short-circuits urgent
 * journeys to the urgent ring.
 */
export async function broadcastUrgentImmediately(
  opts: UrgentBroadcastOpts,
): Promise<string[]> {
  const now = opts.now ?? new Date();
  const tier = tierForCoordinates(opts.pickup.lat, opts.pickup.lng);
  const ring = currentRingForUrgent(tier, now);

  const freshSince = new Date(
    now.getTime() - DRIVER_LOCATION_FRESHNESS_SECONDS * 1000,
  );
  const baseWhere = {
    isOnline: true,
    lastLocationAt: { gte: freshSince },
    lastLat: { not: null as number | null },
    lastLng: { not: null as number | null },
    user: { frozenAt: null },
  } as const;

  let candidates: Array<{
    userId: string;
    lastLat: number | null;
    lastLng: number | null;
  }>;

  if (ring.radiusMeters === RING_NO_LIMIT) {
    candidates = await opts.prisma.driverProfile.findMany({
      where: baseWhere,
      select: { userId: true, lastLat: true, lastLng: true },
    });
  } else {
    const dLat = ring.radiusMeters / METERS_PER_DEG_LAT;
    const dLng = metersToDegLng(ring.radiusMeters, opts.pickup.lat);
    candidates = await opts.prisma.driverProfile.findMany({
      where: {
        ...baseWhere,
        lastLat: {
          gte: opts.pickup.lat - dLat,
          lte: opts.pickup.lat + dLat,
        },
        lastLng: {
          gte: opts.pickup.lng - dLng,
          lte: opts.pickup.lng + dLng,
        },
      },
      select: { userId: true, lastLat: true, lastLng: true },
    });
  }

  const notified: string[] = [];
  for (const c of candidates) {
    if (c.lastLat === null || c.lastLng === null) continue;
    if (ring.radiusMeters !== RING_NO_LIMIT) {
      const dist = haversineMeters(
        { lat: c.lastLat, lng: c.lastLng },
        opts.pickup,
      );
      if (dist > ring.radiusMeters) continue;
    }
    notified.push(c.userId);
    if (opts.io) {
      opts.io.to(`user:${c.userId}`).emit(SOCKET_EVENTS.JOURNEY_AVAILABLE, {
        journeyId: opts.journeyId,
        urgent: true,
      });
    }
  }

  // Auto-bid evaluation runs in setImmediate so socket emit isn't
  // blocked by evaluator latency. Errors are swallowed — a failed
  // auto-bid attempt must not break urgent discovery.
  if (notified.length > 0) {
    const driverIds = [...notified];
    setImmediate(() => {
      evaluateAutoBidsForRingDrivers(
        opts.prisma,
        opts.journeyId,
        driverIds,
        opts.io,
        now,
      ).catch((err) => {
        console.warn('[R3-T] urgent auto-bid-eval-failed', {
          journeyId: opts.journeyId,
          err: err instanceof Error ? err.message : String(err),
        });
      });
    });
  }

  return notified;
}
