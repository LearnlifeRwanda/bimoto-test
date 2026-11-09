import { z } from 'zod';
import { RideReportReason } from '../types/ride-report.js';

// TEAM-ANSWERS G3 — a reason is required to FILE a report (a report
// with no reason tells ops nothing), but filing at all is entirely
// optional and nothing in the ride depends on it. Details are free.
// The 500-character cap matches the rating comment's, so the two
// free-text fields in the app behave alike.
export const createRideReportSchema = z.object({
  reason: z.nativeEnum(RideReportReason),
  details: z.string().max(500).optional(),
});

export type CreateRideReportInput = z.infer<typeof createRideReportSchema>;
