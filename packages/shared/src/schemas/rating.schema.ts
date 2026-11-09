import { z } from 'zod';
import { MIN_RATING, MAX_RATING } from '../constants/config.js';
import { RatingReason } from '../types/rating.js';

export const createRatingSchema = z.object({
  journeyId: z.string().uuid(),
  stars: z.number().int().min(MIN_RATING).max(MAX_RATING),
  comment: z.string().max(500).optional(),
  // TEAM-ANSWERS G2 (item 15) — optional in every path. A low rating
  // MAY carry a reason; nothing here makes one required, and nothing
  // blocks a passenger who just wants to tap the stars and leave.
  reason: z.nativeEnum(RatingReason).optional(),
});

export type CreateRatingInput = z.infer<typeof createRatingSchema>;
