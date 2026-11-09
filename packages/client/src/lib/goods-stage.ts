// LIB/GOODS-STAGE.TS
//
// LOOSE-ENDS G4 — a parcel run that survives a dead battery.
//
// GoodsPickupPage walks a motari through four stages: photograph the
// goods at the pickup, check them against the description, carry them,
// photograph the hand-over. That walk lived entirely in a `useState`
// on the page. Kill the app between the pickup photo and the delivery
// photo — a dead battery, a call, a swipe-away — and reopening it put
// him back on stage one, asking for a photo of goods already strapped
// to his bike and already uploaded to the server.
//
// WHERE THE TRUTH LIVES. The server already knows two of the three
// stage boundaries, because the page's own uploads write them:
// `Journey.pickupPhotoUrl` and `Journey.deliveryPhotoUrl`, both on the
// row `GET /api/journeys/:id` returns to this page on every mount. So
// the recovery ladder reads the SERVER first and only consults the
// device for the one boundary the server cannot see:
//
//   deliveryPhotoUrl present → 'done'
//   pickupPhotoUrl   present → 'confirm_goods', upgraded to
//                              'delivery_photo' iff this device
//                              recorded the confirm tap
//   neither                  → 'pickup_photo'
//
// `confirm_goods → delivery_photo` is the one crossover with no
// network call behind it (handleConfirmGoods is local: he looked in the
// bag and said yes). That single bit is what this module stores, and
// nothing else. Photo URLs, journey state, stage names — none of it is
// mirrored here; the server is authoritative for everything it knows,
// and a stale local bit can only ever move him FORWARD one stage past a
// pickup photo the server has confirmed exists.
//
// WHOSE BIT IT IS. The key carries the userId as well as the journeyId,
// exactly like the sync queues QUEUE-UNITY stamped. Another user
// signing in on the same phone reads their own key, finds nothing, and
// starts from the server's truth. Nothing here is a credential and
// nothing here identifies anybody — it is the string 'confirmed' under
// a key naming a journey — so logout leaves it inert on the device
// rather than deleting it, the same decision session-reset.ts records
// for every other stamped artefact.

import { prefs } from '../hooks/usePreferences';

/** Namespace prefix — grep-able, and distinct from every PREF_KEYS entry. */
const GOODS_CONFIRMED_PREFIX = 'goodsConfirmed';

function keyFor(journeyId: string, userId: string): string {
  return `${GOODS_CONFIRMED_PREFIX}:${journeyId}:${userId}`;
}

/**
 * Did THIS user confirm the goods on THIS journey, on this device?
 *
 * Synchronous, because the page needs it in the same tick it decides
 * which stage to render — the same contract `readSessionSnapshot` uses,
 * and safe for the same reason (`prefs.hydrate()` has already run in
 * main.tsx). A missing id on either side reads as "no".
 */
export function hasConfirmedGoods(journeyId: string | undefined, userId: string | undefined): boolean {
  if (!journeyId || !userId) return false;
  return prefs.getSync(keyFor(journeyId, userId)) === 'true';
}

/**
 * Record the confirm tap. Fire-and-forget: the localStorage write
 * inside is synchronous and only the native write-through is async, and
 * a failed write must never block a motari who is standing at a pickup
 * with a parcel in his hands. The cost of a lost write is one extra tap
 * after a restart, not a lost parcel.
 */
export function markGoodsConfirmed(journeyId: string | undefined, userId: string | undefined): void {
  if (!journeyId || !userId) return;
  void prefs.set(keyFor(journeyId, userId), 'true');
}

/**
 * Forget. Called when the run reaches 'done' — the delivery photo is on
 * the server by then, so the bit has nothing left to decide and leaving
 * it would only accumulate keys on the phone.
 */
export function clearGoodsConfirmed(journeyId: string | undefined, userId: string | undefined): void {
  if (!journeyId || !userId) return;
  void prefs.remove(keyFor(journeyId, userId));
}

export type PickupStep = 'pickup_photo' | 'confirm_goods' | 'delivery_photo' | 'done';

/** The two photo columns of the journey row, as this page sees them. */
export interface GoodsProgress {
  pickupPhotoUrl?: string | null;
  deliveryPhotoUrl?: string | null;
}

/**
 * The stage a reopened page should land on. Server truth outranks the
 * device at every rung: the local bit is consulted only to choose
 * between the two stages a pickup photo is compatible with, and is
 * ignored entirely once the delivery photo exists.
 */
export function recoverStep(
  journey: GoodsProgress | null | undefined,
  confirmed: boolean,
): PickupStep {
  if (journey?.deliveryPhotoUrl) return 'done';
  if (journey?.pickupPhotoUrl) return confirmed ? 'delivery_photo' : 'confirm_goods';
  return 'pickup_photo';
}
