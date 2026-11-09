import { z } from 'zod';
import { MIN_PRICE_RWF, MAX_PRICE_RWF } from '../constants/config.js';

export const createBidSchema = z.object({
  journeyId: z.string().uuid(),
  price: z.number().min(MIN_PRICE_RWF).max(MAX_PRICE_RWF),
  etaMinutes: z.number().int().min(1).max(120),
});

export const acceptBidSchema = z.object({
  bidId: z.string().uuid(),
});

// Card-payment bid acceptance uses the identical input contract as the
// MoMo flow (just the bidId); the divergence is server-side only — the
// card route skips the gateway charge and returns escrow checkout data.
// Aliased rather than re-declared so the two stay in lockstep.
export const acceptBidForCardSchema = acceptBidSchema;

// COUNTER-READY G2 — the passenger's one counter on one bid.
//
// SHAPE ONLY. The bounds (MIN_PRICE_RWF/MAX_PRICE_RWF) and the
// equal-to-the-bid-price refusal deliberately live in the service, not
// here: the validate() middleware answers 400 VALIDATION_ERROR for
// anything zod rejects, and both of those refusals are 422s with names
// of their own that the client renders a specific sentence for. What
// zod owns is "is this an integer number of francs at all".
export const counterBidSchema = z.object({
  counterAmountRwf: z.number().int(),
});

// COUNTER-READY G2 — the motari's answer. Two words, no price: the
// number under discussion is the one already on the bid row, and a
// client that could restate it would be a client that could restate it
// WRONG.
export const counterRespondSchema = z.object({
  action: z.enum(['accept', 'decline']),
});

export type CreateBidInput = z.infer<typeof createBidSchema>;
export type CounterBidInput = z.infer<typeof counterBidSchema>;
export type CounterRespondInput = z.infer<typeof counterRespondSchema>;
export type AcceptBidInput = z.infer<typeof acceptBidSchema>;
export type AcceptBidForCardInput = z.infer<typeof acceptBidForCardSchema>;
