import * as Sentry from '@sentry/node';
import { ZodError } from 'zod';
import type { SyncRejection, SyncRejectionCode, SyncUploadResponse } from '@bimoto/shared';
import prisma from '../prisma';
import { AppError } from '../middleware/error-handler';

interface SyncEventInput {
  clientEventId: string;
  journeyId?: string;
  eventType: string;
  payload: Record<string, unknown>;
  clientTimestamp: string;
}

interface GpsPointInput {
  lat: number;
  lng: number;
  accuracy?: number;
  timestamp: string;
}

function sanitizeMessage(raw: string): string {
  // Strip absolute file paths and stack-trace tails so internals don't leak to clients.
  return raw
    .split('\n')[0]
    .replace(/\(\/[^\s)]+\)/g, '')
    .replace(/\s+at\s+.*$/g, '')
    .trim()
    .slice(0, 200);
}

// R3-SYNC-REJECTION-MODEL — PII-free top-level-keys excerpt for diagnostic.
// Phone numbers, full names, and GPS coords are stripped or city-band-bucketed
// before they reach the SyncRejection table. ≤ 200 chars.
const SUMMARY_MAX = 200;
const KEY_BUDGET = 12;
function summarisePayloadForDiagnostic(
  payload: Record<string, unknown> | null | undefined,
): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const keys = Object.keys(payload);
  if (keys.length === 0) return null;
  const parts: string[] = [];
  for (const key of keys.slice(0, KEY_BUDGET)) {
    const v = (payload as Record<string, unknown>)[key];
    if (v === null || v === undefined) {
      parts.push(`${key}=null`);
    } else if (typeof v === 'boolean') {
      parts.push(`${key}=${v}`);
    } else if (typeof v === 'number') {
      // Number scalars: type only, not value — numeric fields like
      // pickupLat/Lng carry GPS-precision PII; counts and IDs may also
      // be quasi-identifiers. Cardinality info (number) suffices for
      // diagnostic without leaking the value.
      parts.push(`${key}=number`);
    } else if (typeof v === 'string') {
      // String scalars: type + length only, not value — values may
      // carry PII (phone, name, address, free-form notes).
      parts.push(`${key}=string(${v.length})`);
    } else if (Array.isArray(v)) {
      parts.push(`${key}=array(${v.length})`);
    } else {
      parts.push(`${key}=object`);
    }
  }
  const out = parts.join(' ');
  return out.length > SUMMARY_MAX ? `${out.slice(0, SUMMARY_MAX - 1)}…` : out;
}

export function classifyRejection(
  error: unknown,
  clientEventId: string,
): SyncRejection {
  if (error instanceof ZodError) {
    return {
      clientEventId,
      code: 'VALIDATION_ERROR',
      message: sanitizeMessage(error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ') || 'Invalid payload'),
    };
  }

  // Prisma known-request error shape: { code: 'P2003', meta?: {...}, message }
  const maybePrisma = error as { code?: string; meta?: Record<string, unknown>; message?: string };
  if (maybePrisma && typeof maybePrisma.code === 'string') {
    if (maybePrisma.code === 'P2003') {
      return {
        clientEventId,
        code: 'FK_VIOLATION',
        message: 'Referenced entity no longer exists',
        serverState: maybePrisma.meta,
      };
    }
    if (maybePrisma.code === 'P2002') {
      return {
        clientEventId,
        code: 'DUPLICATE_EVENT_ID',
        message: 'Event with this clientEventId was already recorded',
        serverState: maybePrisma.meta,
      };
    }
  }

  const fallbackMessage = error instanceof Error ? error.message : 'Unknown error';
  return {
    clientEventId,
    code: 'UNKNOWN',
    message: sanitizeMessage(fallbackMessage),
  };
}

export async function processEvents(
  userId: string,
  events: SyncEventInput[],
): Promise<SyncUploadResponse> {
  // Sort by clientTimestamp
  const sorted = [...events].sort(
    (a, b) => new Date(a.clientTimestamp).getTime() - new Date(b.clientTimestamp).getTime(),
  );

  const processed: string[] = [];
  const rejected: SyncRejection[] = [];

  for (const event of sorted) {
    try {
      // Deduplicate by clientEventId
      const existing = await prisma.syncEvent.findUnique({
        where: { clientEventId: event.clientEventId },
      });

      if (existing) {
        // Already processed, skip but count as processed
        processed.push(event.clientEventId);
        continue;
      }

      await prisma.syncEvent.create({
        data: {
          userId,
          journeyId: event.journeyId ?? null,
          eventType: event.eventType,
          payload: event.payload as any,
          clientTimestamp: new Date(event.clientTimestamp),
          clientEventId: event.clientEventId,
        },
      });

      processed.push(event.clientEventId);
    } catch (error) {
      const rejection = classifyRejection(error, event.clientEventId);
      rejected.push(rejection);
      const tags: Record<string, string> = {
        sync_rejection_code: rejection.code,
        event_type: event.eventType,
      };
      Sentry.captureException(error, { tags });

      // R3-SYNC-REJECTION-MODEL — persist the rejection so the funnel
      // offline-sync-success metric has a real denominator. If the
      // persistence itself fails, capture to Sentry but do not halt:
      // the client already received the rejection in the response and
      // the sync path is more critical than the diagnostic row.
      try {
        await prisma.syncRejection.create({
          data: {
            userId,
            clientEventId: event.clientEventId,
            eventType: event.eventType,
            rejectionCode: rejection.code,
            rejectionMessage: rejection.message,
            payloadSummary: summarisePayloadForDiagnostic(event.payload),
          },
        });
      } catch (persistError) {
        Sentry.captureException(persistError, {
          tags: { sync_rejection_persistence_failure: 'true' },
        });
      }
    }
  }

  return { processed, rejected };
}

export async function getEventsSince(userId: string, since: Date) {
  const events = await prisma.syncEvent.findMany({
    where: {
      serverTimestamp: { gt: since },
      OR: [
        { userId },
        // Also include events for journeys where the user is a participant
        {
          journey: {
            OR: [{ customerId: userId }, { driverId: userId }],
          },
        },
      ],
    },
    orderBy: { serverTimestamp: 'asc' },
  });

  return events;
}

/**
 * LOOSE-ENDS G5 — GPS points, from a participant only.
 *
 * This checked that the journey EXISTED and nothing else, so any
 * authenticated token could write position points into any journey it
 * could name: somebody else's ride, its own row in the GPS stream, the
 * same table the safety trail and the fare-plausibility checks read.
 * The download leg directly above (`getEventsSince`) has always scoped
 * its read to `customerId | driverId`; the write leg simply never
 * learned who was asking.
 *
 * It does now. The route threads `req.user.userId` through and a
 * non-participant gets 403 — the same verdict, and the same wording,
 * the emergency endpoint gives a non-participant.
 *
 * This is the one deliberately NON-additive change in this dispatch:
 * it narrows what an existing endpoint accepts. A write hole is not a
 * compatibility contract. Every GPS write by an actual participant —
 * which is every write the client has ever made, since the buffer is
 * filled by a phone riding the journey — behaves byte-identically, and
 * that is tested.
 *
 * `userId` is REQUIRED, not optional. An optional caller identity is
 * the same hole with a longer fuse: the next caller that forgets to
 * pass it would silently reopen it, and the type system would say
 * nothing.
 */
export async function saveGpsBatch(journeyId: string, points: GpsPointInput[], userId: string) {
  // Verify journey exists
  const journey = await prisma.journey.findUnique({ where: { id: journeyId } });

  if (!journey) {
    throw new AppError(404, 'JOURNEY_NOT_FOUND', 'errors.journeyNotFound');
  }

  // Participation, not role: the passenger's phone and the motari's
  // phone both buffer points for the same ride.
  if (journey.customerId !== userId && journey.driverId !== userId) {
    throw new AppError(403, 'FORBIDDEN', 'errors.notJourneyParticipant');
  }

  // Deduplicate by journeyId + timestamp
  const existingPoints = await prisma.gpsPoint.findMany({
    where: {
      journeyId,
      timestamp: {
        in: points.map((p) => new Date(p.timestamp)),
      },
    },
    select: { timestamp: true },
  });

  const existingTimestamps = new Set(
    existingPoints.map((p: any) => p.timestamp.toISOString()),
  );

  const newPoints = points.filter(
    (p) => !existingTimestamps.has(new Date(p.timestamp).toISOString()),
  );

  if (newPoints.length === 0) {
    return { saved: 0 };
  }

  await prisma.gpsPoint.createMany({
    data: newPoints.map((p) => ({
      journeyId,
      lat: p.lat,
      lng: p.lng,
      accuracy: p.accuracy ?? null,
      timestamp: new Date(p.timestamp),
    })),
  });

  return { saved: newPoints.length };
}

export type { SyncRejectionCode };
