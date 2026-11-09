import { z } from 'zod';
import { EventType } from '../types/event.js';
import { KIGALI_BOUNDS, GPS_BATCH_MAX_POINTS } from '../constants/config.js';
import { SyncRejectionCodes } from '../types/sync-rejection.js';

export const syncEventInputSchema = z.object({
  clientEventId: z.string().min(1),
  journeyId: z.string().uuid().optional(),
  eventType: z.nativeEnum(EventType),
  payload: z.record(z.unknown()),
  clientTimestamp: z.string().datetime(),
});

export const syncUploadSchema = z.object({
  events: z.array(syncEventInputSchema).min(1).max(100),
});

export const syncRejectionSchema = z.object({
  clientEventId: z.string().min(1),
  code: z.enum(SyncRejectionCodes),
  message: z.string(),
  serverState: z.record(z.unknown()).optional(),
});

export const syncUploadResponseSchema = z.object({
  processed: z.array(z.string()),
  rejected: z.array(syncRejectionSchema),
});

const gpsPointSchema = z.object({
  lat: z.number().min(KIGALI_BOUNDS.minLat).max(KIGALI_BOUNDS.maxLat),
  lng: z.number().min(KIGALI_BOUNDS.minLng).max(KIGALI_BOUNDS.maxLng),
  timestamp: z.string().datetime(),
  accuracy: z.number().min(0).optional(),
  speed: z.number().min(0).optional(),
  heading: z.number().min(0).max(360).optional(),
});

export const gpsBatchSchema = z.object({
  journeyId: z.string().uuid(),
  points: z.array(gpsPointSchema).min(1).max(GPS_BATCH_MAX_POINTS),
});

export type SyncEventInputSchema = z.infer<typeof syncEventInputSchema>;
export type SyncUploadInput = z.infer<typeof syncUploadSchema>;
export type GpsBatchInput = z.infer<typeof gpsBatchSchema>;
export type GpsPoint = z.infer<typeof gpsPointSchema>;
