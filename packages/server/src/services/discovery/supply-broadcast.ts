// SERVICES/DISCOVERY/SUPPLY-BROADCAST.TS
//
// Schedules Socket.io broadcasts to drivers as the discovery cascade
// expands. Called once from journey creation; uses in-process
// setTimeout to fire one broadcast per ring (t=0 plus one per
// ring-duration boundary).
//
// V1 deliberately accepts in-process scheduling: the cascade completes
// in ~6 minutes worst-case (SPARSE), and the journey-feed cascade
// filter is computed on every read so a server restart simply means
// drivers won't get the live notification — they'll still see the
// journey in their next feed poll. V2 may move this to a cron-driven
// broadcaster.

import type { Server as SocketIOServer } from 'socket.io';
import type { PrismaClient } from '@prisma/client';
import {
  cascadeConfigForPickup,
  haversineMeters,
} from './cascade';
import {
  DRIVER_LOCATION_FRESHNESS_SECONDS,
  RING_NO_LIMIT,
} from './config';
import { notifyDriversOfRingExpansion } from './notify-on-expansion';
import { evaluateAutoBidsForRingDrivers } from '../auto-bid/cascade-integration';
import { SOCKET_EVENTS } from '@bimoto/shared';

const METERS_PER_DEG_LAT = 111_320;

function metersToDegLng(meters: number, lat: number): number {
  const cos = Math.max(0.01, Math.cos((lat * Math.PI) / 180));
  return meters / (METERS_PER_DEG_LAT * cos);
}

export interface ScheduleCascadeBroadcastsOpts {
  prisma: PrismaClient;
  io: SocketIOServer | null;
  journeyId: string;
  pickup: { lat: number; lng: number };
  discoveryStartedAt: Date;
  // Allow tests to inject a Map; production uses the module-level one.
  notifiedRegistry?: Map<string, Set<string>>;
}

// Module-level "already notified for this journey" registry. Keyed by
// journeyId, value is the set of driverIds who've already received
// the journey:available event so ring-expansions don't double-notify.
// Production code uses this; tests can pass their own to assert
// state.
const notifiedDriversByJourney = new Map<string, Set<string>>();

export function getNotifiedRegistry(): Map<string, Set<string>> {
  return notifiedDriversByJourney;
}

export function _resetNotifiedRegistryForTests(): void {
  notifiedDriversByJourney.clear();
}

export async function broadcastToRingDrivers(opts: {
  prisma: PrismaClient;
  io: SocketIOServer | null;
  journeyId: string;
  pickup: { lat: number; lng: number };
  ringRadiusMeters: number;
  notifiedRegistry?: Map<string, Set<string>>;
  now?: Date;
}): Promise<string[]> {
  const now = opts.now ?? new Date();
  const registry = opts.notifiedRegistry ?? notifiedDriversByJourney;
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

  if (opts.ringRadiusMeters === RING_NO_LIMIT) {
    candidates = await opts.prisma.driverProfile.findMany({
      where: baseWhere,
      select: { userId: true, lastLat: true, lastLng: true },
    });
  } else {
    const dLat = opts.ringRadiusMeters / METERS_PER_DEG_LAT;
    const dLng = metersToDegLng(opts.ringRadiusMeters, opts.pickup.lat);
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

  let alreadyNotified = registry.get(opts.journeyId);
  if (!alreadyNotified) {
    alreadyNotified = new Set<string>();
    registry.set(opts.journeyId, alreadyNotified);
  }

  const newlyNotified: string[] = [];
  for (const c of candidates) {
    if (c.lastLat === null || c.lastLng === null) continue;
    if (opts.ringRadiusMeters !== RING_NO_LIMIT) {
      const dist = haversineMeters(
        { lat: c.lastLat, lng: c.lastLng },
        opts.pickup,
      );
      if (dist > opts.ringRadiusMeters) continue;
    }
    if (alreadyNotified.has(c.userId)) continue;
    alreadyNotified.add(c.userId);
    newlyNotified.push(c.userId);
    if (opts.io) {
      opts.io.to(`user:${c.userId}`).emit(SOCKET_EVENTS.JOURNEY_AVAILABLE, {
        journeyId: opts.journeyId,
      });
    }
  }
  notifyDriversOfRingExpansion(opts.journeyId, newlyNotified);

  // Dispatch K2: hook auto-bid evaluation into the cascade. We fire
  // off in setImmediate so the Socket.io broadcast is never blocked
  // by evaluator latency. Errors are logged but never propagated —
  // a failed auto-bid attempt must not break discovery.
  if (newlyNotified.length > 0 && opts.prisma) {
    const driverIds = [...newlyNotified];
    setImmediate(() => {
      evaluateAutoBidsForRingDrivers(
        opts.prisma,
        opts.journeyId,
        driverIds,
        opts.io,
        now,
      ).catch((err) => {
        console.warn('[K2] auto-bid-eval-failed-in-broadcast', {
          journeyId: opts.journeyId,
          err: err instanceof Error ? err.message : String(err),
        });
      });
    });
  }

  return newlyNotified;
}

export interface CascadeBroadcastHandle {
  timers: NodeJS.Timeout[];
  // Cancellable handle — once a journey leaves REQUESTED (matched,
  // cancelled), callers can cancel the rest of the cascade.
  cancel: () => void;
}

// Fire-and-forget the broadcast and swallow errors. Cascade
// scheduling is non-critical: the journey-feed cascade filter is
// computed on every read, so a failed broadcast never blocks
// discovery — it only means drivers miss the live socket nudge.
function safeBroadcast(args: Parameters<typeof broadcastToRingDrivers>[0]): void {
  broadcastToRingDrivers(args).catch((err) => {
    console.warn('[K1] cascade broadcast failed', {
      journeyId: args.journeyId,
      ringRadiusMeters: args.ringRadiusMeters,
      err: err instanceof Error ? err.message : String(err),
    });
  });
}

export function scheduleCascadeBroadcasts(
  opts: ScheduleCascadeBroadcastsOpts,
): CascadeBroadcastHandle {
  const config = cascadeConfigForPickup(
    opts.pickup.lat,
    opts.pickup.lng,
  );
  const timers: NodeJS.Timeout[] = [];

  // Ring 0 fires immediately (no setTimeout).
  safeBroadcast({
    prisma: opts.prisma,
    io: opts.io,
    journeyId: opts.journeyId,
    pickup: opts.pickup,
    ringRadiusMeters: config.rings[0],
    notifiedRegistry: opts.notifiedRegistry,
  });

  for (let i = 1; i < config.rings.length; i++) {
    const delay = i * config.ringDurationSeconds * 1000;
    const ringRadius = config.rings[i];
    const t = setTimeout(() => {
      safeBroadcast({
        prisma: opts.prisma,
        io: opts.io,
        journeyId: opts.journeyId,
        pickup: opts.pickup,
        ringRadiusMeters: ringRadius,
        notifiedRegistry: opts.notifiedRegistry,
      });
    }, delay);
    timers.push(t);
  }

  return {
    timers,
    cancel: () => {
      for (const t of timers) clearTimeout(t);
    },
  };
}
