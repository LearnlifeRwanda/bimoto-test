import { VehicleType } from './user.js';
import type { ParcelCategory } from './leg.js';

export enum JourneyType {
  PASSENGER = 'PASSENGER',
  GOODS = 'GOODS',
  // R3-PRIORITY — intermediate-urgency parcel. 1.15x fare + half-speed cascade.
  PRIORITY_MESSENGER = 'PRIORITY_MESSENGER',
  // R3-T — time-sensitive parcel. Cascade bypass + 1.3x premium + SLA window.
  URGENT_MESSENGER = 'URGENT_MESSENGER',
}

/**
 * TEAM-SAID G3 — delivery speed, exactly two tiers (Jean, item 13).
 *
 * Note what this enum deliberately is NOT: a price. Unlike JourneyType
 * above — where PRIORITY_MESSENGER and URGENT_MESSENGER each carry a
 * stated multiplier — neither value here multiplies anything. Express
 * is a label the motari reads on the request, and the fare is agreed
 * through the same passenger-suggests / driver-bids mechanic as every
 * other journey. The team asked explicitly for no predetermined
 * surcharge, so there is no percentage table to find here and none to
 * be added later without revisiting that decision.
 */
export enum DeliverySpeed {
  /** Carries the "about 1 to 3 hours" promise. */
  STANDARD = 'STANDARD',
  /** Faster, priced by bidding — no surcharge, no percentage. */
  EXPRESS = 'EXPRESS',
}

export enum JourneyStatus {
  SCHEDULED = 'SCHEDULED',
  REQUESTED = 'REQUESTED',
  MATCHED = 'MATCHED',
  IN_PROGRESS = 'IN_PROGRESS',
  AWAITING_CONFIRMATION = 'AWAITING_CONFIRMATION',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  INTERRUPTED = 'INTERRUPTED',
  DISPUTED = 'DISPUTED',
  EXPIRED = 'EXPIRED',
}

export enum BookingMode {
  IMMEDIATE = 'IMMEDIATE',
  SCHEDULED = 'SCHEDULED',
}

export enum JourneyAction {
  ACCEPT_BID = 'ACCEPT_BID',
  CANCEL = 'CANCEL',
  START_JOURNEY = 'START_JOURNEY',
  END_JOURNEY = 'END_JOURNEY',
  CONFIRM = 'CONFIRM',
  DISPUTE = 'DISPUTE',
  INTERRUPT = 'INTERRUPT',
  EXPIRE = 'EXPIRE',
  AUTO_CONFIRM = 'AUTO_CONFIRM',
  OPEN_BID_WINDOW = 'OPEN_BID_WINDOW',
  LATE_END_JOURNEY = 'LATE_END_JOURNEY',
  CUSTOMER_COMPLETE = 'CUSTOMER_COMPLETE',
  RECONCILE_BOTH_ARRIVED = 'RECONCILE_BOTH_ARRIVED',
  RECONCILE_CONFLICT = 'RECONCILE_CONFLICT',
  // R3-RECONCILIATION-WIRING-FIX — admin resolution of a DISPUTED journey.
  ADMIN_REFUND = 'ADMIN_REFUND',
  ADMIN_PAY = 'ADMIN_PAY',
}

export interface CommissionBreakdown {
  bidPrice: number;
  driverTier: string;
  driverCommissionRate: number;
  customerTier: string;
  customerCommissionRate: number;
  totalCommissionRate: number;
  // Nominal tier commission — always computed, never skipped. A fee
  // waiver zeroes what is CHARGED (chargedCommissionAmount), not what
  // the ladder says.
  totalCommissionAmount: number;
  // What the driver actually keeps: the whole fare under a waiver.
  driverPayout: number;
  customerSavings: number;
  driverSavings: number;
  // LAUNCH-TRUTH — waived-commission truth. Optional: cached responses
  // and fixtures from before the pilot waiver omit them.
  feeWaiverApplied?: boolean;
  chargedCommissionAmount?: number;
  waivedCommissionAmount?: number;
}

export interface Journey {
  id: string;
  customerId: string;
  driverId?: string;
  type: JourneyType;
  status: JourneyStatus;
  pickupLat: number;
  pickupLng: number;
  pickupName: string;
  destinationLat: number;
  destinationLng: number;
  destinationName: string;
  // LANDMARKS G4 — the passenger's own words about each place, for the
  // places no database knows. Absent on every journey created before the
  // field existed, and on every journey where nothing was written.
  pickupDescription?: string;
  destinationDescription?: string;
  // TEAM-SAID G1 — the passenger warned that a child is coming. An
  // advisory the motari reads before he accepts; it is not
  // hasChildPassenger and carries none of that field's pricing or
  // acknowledgment behaviour. Absent (not false) on every journey
  // booked before the field existed.
  travellingWithChild?: boolean;
  vehiclePreference?: VehicleType;
  wishPrice?: number;
  agreedPrice?: number;
  commissionAmount?: number;
  estimatedDistance?: number;
  startedAt?: string;
  endedAt?: string;
  confirmedAt?: string;
  createdAt: string;
  updatedAt: string;
  goodsDescription?: string;
  goodsSizeCategory?: string;
  // PARCEL-CATEGORY — what the parcel CONTAINS, the same five choices
  // the drop-a-package leg flow has asked since R3-DELIVERY-V2, now
  // asked of the send-a-package sender too. The type is imported, not
  // redeclared: one enum, one list, one set of locale keys.
  //
  // Absent (not OTHER) on every parcel booked before the question
  // existed — it was never asked, and the driver's screen renders no
  // badge rather than a wrong one.
  parcelCategory?: ParcelCategory;
  // TEAM-SAID G3 — the tier the sender chose. Absent (not STANDARD) on
  // every parcel booked before tiers existed: it was never asked.
  deliverySpeed?: DeliverySpeed;
  /** LIVE-WIRE G5 — optional 1/2/3-hour window, STANDARD only. */
  standardDeliveryHours?: 1 | 2 | 3;
  goodsFragile: boolean;
  recipientName?: string;
  recipientPhone?: string;
  pickupPhotoUrl?: string;
  deliveryPhotoUrl?: string;
  bookingMode?: BookingMode;
  scheduledFor?: string;
  bidWindowOpensAt?: string;
  autoFallbackAt?: string;
  lastReminderSentAt?: string;
  // R3-T — set at acceptBid for URGENT_MESSENGER (matchedAt + 30 min).
  targetCompletionAt?: string;
}
