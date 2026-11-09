// R3-LEGS — multi-stop trip foundation. Mirror of the Prisma types
// for client + server consumption.

import { Language } from './user';

export type LegType =
  | 'PASSENGER_PICKUP'
  | 'PASSENGER_DROPOFF'
  | 'GOODS_PICKUP'
  | 'GOODS_DROPOFF'
  | 'WAIT';

export type LegStatus = 'PENDING' | 'ACTIVE' | 'COMPLETED' | 'SKIPPED';

// R3-DELIVERY — parcel size for goods stops. Drives the 4th
// compositional fare axis via parcelMultiplier in fair-price.service.ts.
export type ParcelSize = 'SMALL' | 'MEDIUM' | 'LARGE';

// R3-DELIVERY-V2 — parcel content category. Surfaced as a handling
// badge on the driver bid page; optional on goods legs (UI defaults to
// OTHER on submit), forbidden on non-goods legs.
export type ParcelCategory =
  | 'FOOD'
  | 'ELECTRONICS'
  | 'DOCUMENTS'
  | 'FRAGILE'
  | 'OTHER';

// R3-RECIPIENT-CONFIRM-2 — how the GOODS_DROPOFF leg reached the
// "recipient acknowledged" state. NULL on legacy R3-RECIPIENT-CONFIRM
// rows (which only stamped recipientConfirmedAt). UI treats null status
// with non-null confirmedAt as a legacy explicit confirmation.
export type RecipientConfirmStatus =
  | 'EXPLICIT_REPLY'
  | 'AUTO_TIMEOUT'
  | 'DISPUTED';

export interface Leg {
  id: string;
  journeyId: string;
  sequence: number;
  type: LegType;
  status: LegStatus;
  lat: number;
  lng: number;
  name: string;
  contactName?: string | null;
  contactPhone?: string | null;
  expectedDurationMinutes?: number | null;
  parcelSize?: ParcelSize | null;
  parcelCategory?: ParcelCategory | null;
  completedAt?: string | null;
  // R3-RECIPIENT-CONFIRM — server-set when a parcel recipient SMS-replies
  // to the delivered notification with a confirmation keyword. Surfaced on
  // the customer's journey progress page as a "Recipient confirmed" badge.
  // Never client-input (LegInput omits it).
  recipientConfirmedAt?: string | null;
  // R3-DELIVERY-NOTIFICATIONS-2 — optional per-recipient language hint
  // entered by the customer in GoodsStopEditor. NULL falls back to the
  // journey customer's User.language at SMS-compose time.
  recipientLanguage?: Language | null;
  // R3-RECIPIENT-CONFIRM-2 — how the recipient acknowledgement was reached.
  // Set in lock-step with recipientConfirmedAt (server-only). Null when
  // recipientConfirmedAt is null OR for legacy R3-RECIPIENT-CONFIRM rows.
  recipientConfirmStatus?: RecipientConfirmStatus | null;
  // R3-RECIPIENT-CONFIRM-2 — verbatim SMS body when a recipient flagged
  // the parcel as wrong/damaged. Set only when status = DISPUTED.
  recipientDisputeReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Input shape for creating a leg as part of a journey. Used by
 * createJourney's optional `legs[]` field.
 */
export interface LegInput {
  type: LegType;
  lat: number;
  lng: number;
  name: string;
  contactName?: string | null;
  contactPhone?: string | null;
  expectedDurationMinutes?: number | null;
  parcelSize?: ParcelSize | null;
  parcelCategory?: ParcelCategory | null;
  // R3-DELIVERY-NOTIFICATIONS-2 — optional per-recipient language hint.
  recipientLanguage?: Language | null;
}
