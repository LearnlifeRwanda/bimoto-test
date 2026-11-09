// ADDR-FIX G2 — clients before CREATE-FIX (#117) built offline journeys
// with pickupAddress/destinationAddress, and those raw inputs were written
// into db.journeys verbatim. Rows in that legacy shape would render blank
// under the correct pickupName/destinationName reads, so cache reads run
// through this: prefer the correct field, fall back to the legacy one,
// and drop the legacy keys so a healed write stores only the real shape.
export function normalizeLegacyJourney<T extends { id: string }>(row: T): T {
  const legacy = row as T & {
    pickupAddress?: unknown;
    destinationAddress?: unknown;
    pickupName?: unknown;
    destinationName?: unknown;
  };
  if (legacy.pickupAddress === undefined && legacy.destinationAddress === undefined) {
    return row;
  }
  const { pickupAddress, destinationAddress, ...rest } = legacy;
  return {
    ...rest,
    pickupName: legacy.pickupName ?? pickupAddress,
    destinationName: legacy.destinationName ?? destinationAddress,
  } as T;
}

export interface LocalJourney {
  id: string;
  customerId: string;
  driverId?: string;
  type: string;
  status: string;
  pickupLat: number;
  pickupLng: number;
  pickupName: string;
  destinationLat: number;
  destinationLng: number;
  destinationName: string;
  vehiclePreference?: string;
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
  goodsFragile?: boolean;
  recipientName?: string;
  recipientPhone?: string;
  pickupPhotoUrl?: string;
  deliveryPhotoUrl?: string;
}

export interface LocalBid {
  id: string;
  journeyId: string;
  driverId: string;
  price: number;
  etaMinutes: number;
  status: string;
  createdAt: string;
  updatedAt: string;
  driverNickname?: string;
  driverRating?: number;
  driverRides?: number;
  driverVehicleType?: string;
  driverVehicleDescription?: string;
  driverPlate?: string;
}

export interface LocalMessage {
  id: string;
  journeyId: string;
  senderId: string;
  text: string;
  isQuickMessage: boolean;
  quickMessageId?: string;
  createdAt: string;
}

// QUEUE-UNITY G2 — whose row this is.
//
// `null` means "written before the queue knew how to say". Such a row is
// quarantined: it is never drained, never rendered and never deleted on
// its owner's behalf. It is not a missing value to be filled in later —
// filling it in is the mis-attribution the stamp exists to prevent.
export type QueueOwner = string | null;

export interface PendingSyncEvent {
  id?: number;
  /** Auth-store user id of whoever enqueued this. Never inferred. */
  userId: QueueOwner;
  clientEventId: string;
  journeyId?: string;
  eventType: string;
  payload: Record<string, unknown>;
  clientTimestamp: string;
  synced: boolean;
  failReason?: string;
}

export interface GpsBuffer {
  id?: number;
  /** Auth-store user id of whoever was riding. Never inferred. */
  userId: QueueOwner;
  journeyId: string;
  lat: number;
  lng: number;
  accuracy?: number;
  timestamp: string;
  synced: boolean;
}

export interface SyncMeta {
  key: string;
  value: string;
}

// OUTBOX G2 — a booking the passenger made with no network, held on
// this phone until it can be sent.
//
// This is deliberately NOT `syncEvents`. That queue is alive and drains
// to POST /api/sync/events with an eventType/payload envelope (see
// docs/outbox-terrain-survey.md); teaching it a "journey-create" event
// would give the server a second way to create a journey. An outbox
// entry is the ORIGINAL request, held back: the same body, to the same
// endpoint, with the same identity it would have had online.
//
// The thing `syncEvents` could not do, and the reason this table exists
// at all, is the first column: WHOSE booking this is. A phone in Kigali
// changes hands, and an unstamped queue can only either destroy the
// previous user's work or send it under the next user's name — the seam
// lib/session-reset.ts wrote down and could not close.
export type OutboxKind = 'journey-create';

/**
 * PENDING — waiting for a connection, or in flight right now.
 * REJECTED — the server answered 4xx. A real answer, not a hiccup: it
 *   is shown to the user with the server's own reason and is NEVER
 *   retried on its own. Only the user's hand clears it.
 */
export type OutboxStatus = 'PENDING' | 'REJECTED';

export interface OutboxEntry {
  id?: number;
  /** Auth-store user id of whoever made this booking. Never inferred. */
  userId: string;
  kind: OutboxKind;
  status: OutboxStatus;
  /**
   * Client-generated uuid, minted BEFORE the first attempt and reused
   * verbatim on every replay. Travels as `clientRequestId` in the create
   * body and is what stops a lost 201 from becoming two rides.
   */
  clientId: string;
  /** ISO timestamp of the moment the passenger pressed the button. */
  createdAt: string;
  /** The create body, exactly as the page built it. Unindexed. */
  payload: Record<string, unknown>;
  /** Server error code, when status is REJECTED. */
  failCode?: string;
  /** Server message (i18n key or prose), when status is REJECTED. */
  failMessage?: string;
}

// MAP-CACHE G2 — one row per offline map extract (today only 'kigali').
// The whole PMTiles archive lives in `blob`; IndexedDB stores Blobs
// natively, so nothing is base64-inflated.
export interface MapCacheEntry {
  /** Extract identifier — 'kigali'. */
  key: string;
  blob: Blob;
  sizeBytes: number;
  /** ISO timestamp of the completed download. */
  downloadedAt: string;
}

/**
 * MAP-TRUTH G4 — a download that was interrupted, kept so it can be
 * resumed instead of restarted. A ~30 MB archive over Kigali mobile data
 * does not always finish first go, and throwing away 28 MB because a
 * tunnel ate the last two is not a download, it is a lottery.
 *
 * `etag` is the server validator the bytes were fetched under. Resuming
 * sends it back as If-Range, so a partial from before an update-bundle
 * swap is discarded rather than spliced onto a different archive.
 */
export interface MapDownloadPartial {
  /** Extract identifier — 'kigali'. */
  key: string;
  blob: Blob;
  receivedBytes: number;
  /** Total the server reported for the whole archive, when it said. */
  totalBytes: number | null;
  etag: string | null;
  /** ISO timestamp of the last byte received. */
  updatedAt: string;
}
