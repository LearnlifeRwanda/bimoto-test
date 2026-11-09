// CONSTANTS/SOCKET-EVENTS.TS
//
// SOCKET-FIX G1 — the single source of truth for every app-defined
// Socket.io event name on either side of the wire. Every server emit
// and every client listener/emitter must reference these constants;
// a raw event-name string literal in either package fails the
// contract test (shared/src/__tests__/socket-event-contract.test.ts).
//
// This file exists because the event names used to be free-floating
// string literals, which is how the discovery feed shipped severed:
// the server emitted 'journey:available' while the client listened
// for 'journey:nearby' — an event nothing ever emitted.
//
// Naming note — the SOCKET-FIX audit surfaced two pre-existing name
// mismatches, both since unified to the server's spelling:
//   * 'bid-placed' (server, journey room) vs 'bid:placed' (client
//     listener) — unified by SOCKET-HYGIENE G3: BID_PLACED is now
//     'bid-placed' on both sides and the former JOURNEY_ROOM_BID_PLACED
//     twin is gone.
//   * 'emergency-alert' (server) vs 'emergency:alert' (client) —
//     unified by SOS-WIRE G1 to the server's spelling: EMERGENCY_ALERT
//     is now 'emergency-alert' on both sides and the former
//     JOURNEY_ROOM_EMERGENCY_ALERT twin is gone. The server emits it
//     to the journey room and to the 'admins' room.

import type { JourneyType } from '../types/journey.js';

export const SOCKET_EVENTS = {
  // ── Client → server ─────────────────────────────────────────────
  JOIN_JOURNEY: 'join-journey',
  LEAVE_JOURNEY: 'leave-journey',
  UPDATE_LOCATION: 'update-location',

  // ── Server → client (user-room / direct emits) ──────────────────
  ERROR: 'error',
  JOURNEY_AVAILABLE: 'journey:available',
  JOURNEY_WISH_PRICE_UPDATED: 'journey:wish-price-updated',
  ACCOUNT_FROZEN: 'account-frozen',
  AUTO_BID_FIRED: 'auto-bid:fired',
  SUGGEST_UP_AVAILABLE: 'suggest-up:available',

  // ── NOTIFY G3 — the news a person is told IN THE APP ────────────
  //
  // Six events that did not exist because the notifications they belong
  // to did not reach anybody. Every notify* helper in
  // services/notification.service.ts composes push and ONLY push, and
  // push has no APNS/FCM credentials (Barack, 24 Aug), so a driver
  // whose escrow was released was told by a console.log on a server he
  // will never read. These are the in-app half.
  //
  // ALL SIX GO TO ONE NAMED USER'S ROOM (`user:${userId}`, emitToUser)
  // and to nowhere else — never a journey room, which holds two people,
  // and never a broadcast. Each payload below carries the smallest
  // thing its toast needs and no strip-floor field: no phone, no
  // coordinates, no name, no plate.
  //
  // The push half lights up with ZERO code change the day the
  // credentials land: sendPushToUser is already composed alongside each
  // of these, in the same helper.
  ESCROW_RELEASED: 'escrow:released',
  ESCROW_REFUNDED: 'escrow:refunded',
  RATING_RECEIVED: 'rating:received',
  VERIFICATION_DECIDED: 'verification:decided',
  NO_SHOW_WARNING: 'no-show:warning',
  DISPUTE_RESOLVED: 'dispute:resolved',

  // ── COUNTER-READY G2 — the one-counter-per-bid conversation ──────
  //
  // Three events, all emitToUser to ONE named recipient's room and to
  // nowhere else, composed inside notification.service exactly like the
  // six above. They are emitted only while COUNTER_BID_ENABLED is on:
  // with the switch off the endpoints that would fire them answer 403
  // before reaching any emit, so a dormant server puts nothing on the
  // wire.
  //
  // BID_COUNTERED goes to the DRIVER whose bid was countered — his
  // offer is still live and somebody has proposed a different number for
  // it. COUNTER_ACCEPTED and COUNTER_DECLINED go back to the CUSTOMER
  // who made the counter. Nobody else hears any of it; a counter is a
  // private exchange between one passenger and one motari, and the
  // journey room (which is the passenger alone while REQUESTED) is the
  // wrong place for all three.
  BID_COUNTERED: 'bid:countered',
  COUNTER_ACCEPTED: 'counter:accepted',
  COUNTER_DECLINED: 'counter:declined',

  // ── Server → client (journey-room broadcast from update-location) ─
  // Live location streaming runs over UPDATE_LOCATION / DRIVER_LOCATION
  // (see useDriverLocationBroadcast / -Stream). The former
  // DRIVER_LOCATION_CLIENT twin ('driver:location') was dead on both
  // sides and removed by SOCKET-HYGIENE G2.
  DRIVER_LOCATION: 'driver-location',

  // ── Bid placed (journey room) ───────────────────────────────────
  // Emitted by POST /journeys/:id/bids to the journey room with the
  // created bid; useSocket listens (addBid + toast). Formerly split as
  // 'bid-placed' (server) / 'bid:placed' (client) — unified by
  // SOCKET-HYGIENE G3 to the server's spelling.
  BID_PLACED: 'bid-placed',

  // ── Emergency (SOS-WIRE G1) ─────────────────────────────────────
  // Emitted by POST /journeys/:id/emergency to the journey room
  // (customer + driver) and to the 'admins' room (admin-role sockets
  // join it at connect). useSocket and the admin alert surface both
  // listen for this one name.
  EMERGENCY_ALERT: 'emergency-alert',

  // ── Emergency ended (SOS-FOLLOW G3) ─────────────────────────────
  // Emitted by the admin resolve endpoint and by the 60-minute expiry
  // valve, to the 'admins' room AND to the journey room.
  //
  // This is the ONLY new journey-room event this work adds, and it is
  // the reason the follow can be allowed at all: both participants'
  // devices are streaming their position while the alert is ACTIVE, and
  // this is what tells them to stop. It carries the alert's identity and
  // its terminal status and NOTHING ELSE — no coordinates, in either
  // direction, ever. See EmergencyEndedEvent below.
  EMERGENCY_ENDED: 'emergency-ended',

  // ── Emergency follow stream (SOS-FOLLOW G4) ─────────────────────
  // The live follow, which exists ONLY while an alert is ACTIVE.
  //
  // EMERGENCY_LOCATION is client → server: both participants' phones
  // send it while their device knows the alert is live. The server
  // re-checks participation AND the ACTIVE alert on every frame and
  // silently drops anything else.
  //
  // EMERGENCY_LOCATION_UPDATE is server → the 'admins' room and NOWHERE
  // ELSE. It is the only event in this system that carries a live
  // position to somebody who is not on the journey, and what makes that
  // acceptable is that it is emitted through emitToAdmins alone: never
  // to a journey room, never to a per-user room, never to the other
  // participant. Nobody can watch a ride. Ops can follow an emergency,
  // for as long as that emergency is open.
  EMERGENCY_LOCATION: 'emergency-location',
  EMERGENCY_LOCATION_UPDATE: 'emergency-location-update',

  // ── Server → journey room via emitToJourney ─────────────────────
  // NEW_MESSAGE is LIVE (useSocket listens); the rest are emit-only
  // forward wiring for unbuilt UI — see docs/socket-wiring-audit.md.
  NEW_MESSAGE: 'new-message',
  JOURNEY_CREATED: 'journey-created',
  JOURNEY_STARTED: 'journey-started',
  JOURNEY_ENDED: 'journey-ended',
  JOURNEY_CONFIRMED: 'journey-confirmed',
  JOURNEY_DISPUTED: 'journey-disputed',
  JOURNEY_INTERRUPTED: 'journey-interrupted',
  JOURNEY_CANCELLED: 'journey-cancelled',
  JOURNEY_EXPIRED: 'journey-expired',
  JOURNEY_AUTO_CONFIRMED: 'journey-auto-confirmed',
  JOURNEY_RECONCILED: 'journey-reconciled',
  JOURNEY_RECONCILIATION_REQUIRED: 'journey-reconciliation-required',
  BID_ACCEPTED: 'bid-accepted',
  BID_WITHDRAWN: 'bid-withdrawn',
  BID_DECLINED: 'bid-declined',
  BID_EXPIRED: 'bid-expired',
  SCHEDULED_RIDE_REMINDER: 'scheduled-ride-reminder',
  SCHEDULED_RIDE_MATCHED: 'scheduled-ride-matched',
  SCHEDULED_RIDE_EXPIRED: 'scheduled-ride-expired',
  SCHEDULED_RIDE_CANCELLED: 'scheduled-ride-cancelled',
  SCHEDULED_RIDE_BID_WINDOW_OPENED: 'scheduled-ride-bid-window-opened',
} as const;

export type SocketEventName = (typeof SOCKET_EVENTS)[keyof typeof SOCKET_EVENTS];

// ── Event payload contracts ───────────────────────────────────────
// The server's emitted shapes are the contract; the client conforms.
// Shapes below are transcribed from the emit sites named in each
// comment — change them only when the emit site changes.

/** JOURNEY_AVAILABLE — discovery/supply-broadcast.ts (ring cascade)
 *  and discovery/urgent-broadcast.ts (R3-T single-shot fan-out).
 *  The urgent path adds `urgent: true`; the ring path omits it. */
export interface JourneyAvailableEvent {
  journeyId: string;
  urgent?: boolean;
}

/** JOURNEY_WISH_PRICE_UPDATED — customer-modes/suggest-up.ts. */
export interface JourneyWishPriceUpdatedEvent {
  journeyId: string;
  wishPrice: number;
  suggestUpCount: number;
  addRwf: number;
}

/** ACCOUNT_FROZEN — admin/socket-disconnect.helper.ts. The socket is
 *  force-disconnected immediately after this event is emitted. */
export interface AccountFrozenEvent {
  reason: string;
}

/** AUTO_BID_FIRED — auto-bid/evaluator.ts. */
export interface AutoBidFiredEvent {
  journeyId: string;
  bidId: string;
  ruleId: string;
  bidAmount: number;
}

/** EMERGENCY_ALERT — journey.routes.ts (POST /journeys/:id/emergency).
 *  Emitted to the journey room (base fields only) and to the 'admins'
 *  room (plus riderNickname/riderPhone, which the admin banner needs
 *  and journey participants must not receive). */
export interface EmergencyAlertEvent {
  journeyId: string;
  /**
   * SOS-FOLLOW G2 — the identity of the ACTIVE EmergencyAlert row this
   * press opened or joined.
   *
   * An emergency is a STATE now, not only an event, and this is that
   * state's name. Both participants' devices key their follow stream on
   * it and the ops list keys its live positions on it.
   *
   * Optional, for the same reason `raisedBy` and `journeyType` are: a
   * payload emitted before this field existed, or replayed from a log,
   * carries none — and, deliberately, so does an alert whose state row
   * failed to write. Every fan-out channel fires regardless; a missing
   * alertId costs the live follow and never the alarm.
   */
  alertId?: string;
  userId: string;
  lat?: number;
  lng?: number;
  timestamp: string;
  /**
   * RED-BUTTON G2 — WHO pressed the button. Both journey participants
   * can raise an alert, and the rider* fields below always mean THE
   * PASSENGER regardless of who did, so this is the only field that
   * says whose emergency it is.
   *
   * OUTBOX G5 — declared here because the server has been sending it
   * since #166 while this type did not admit it existed, which is how
   * the admin banner came to announce every alert as the passenger's.
   * Optional: an alert emitted before #166, replayed from a log, has
   * none, and the banner falls back to the passenger reading it had.
   */
  raisedBy?: 'CUSTOMER' | 'DRIVER';
  /**
   * LOOSE-ENDS G3 — WHAT KIND of journey this is.
   *
   * `raisedBy` fixed who pressed the button; it did not fix what the
   * alert says is happening. Every emergency surface — the banner, the
   * toast, both SMS bodies — called the journey "a ride", so a man
   * carrying somebody's parcel raised an alert and his mother was told
   * he was on a ride with a passenger who does not exist.
   *
   * Four of the enum's members exist and three of them are parcels
   * (GOODS, PRIORITY_MESSENGER, URGENT_MESSENGER), so every consumer
   * branches on `!== PASSENGER`, never on `=== GOODS` — an urgent
   * messenger run is not a ride either.
   *
   * Optional, exactly like `raisedBy` above and for the same reason: a
   * deployed APK's payload, or an alert replayed from a log, carries
   * none, and every consumer falls back to the ride-shaped wording it
   * has today.
   */
  journeyType?: JourneyType;
  /** admins-room emit only. Always the PASSENGER, in both directions. */
  riderNickname?: string;
  /** admins-room emit only (decrypted; never sent to the journey room) */
  riderPhone?: string | null;
  /** admins-room emit only. Always the MOTARI, in both directions. */
  driverNickname?: string;
  /** admins-room emit only (decrypted; never sent to the journey room) */
  driverPhone?: string | null;
  /** admins-room emit only — the vehicle ops would be looking for. */
  driverPlate?: string | null;
}

/**
 * EMERGENCY_ENDED — SOS-FOLLOW G3. Emitted by the admin resolve
 * endpoint (routes/admin-emergency.routes.ts) and by the expiry valve
 * (jobs/emergency-expiry.job.ts), to BOTH the 'admins' room and the
 * journey room.
 *
 * THE PAYLOAD IS THE INVARIANT. An emergency is the one circumstance in
 * which anybody may follow a ride, and the follow is ops-only: no
 * position data reaches a journey room or any non-admin user, at any
 * point, by any path. This event is the single new thing the journey
 * room hears, so its shape is deliberately the smallest thing that can
 * stop a stream — an id, the journey it belongs to, and which of the two
 * terminal states it landed in.
 *
 * There is no lat, no lng, no accuracy, no last-known-position and no
 * note. The note is written on the row and read by ops behind adminOnly;
 * a participant is told their emergency is closed, not what an
 * administrator wrote about it. A test asserts this shape
 * (sosfollow-never-broadcast.test.ts).
 */
export interface EmergencyEndedEvent {
  alertId: string;
  journeyId: string;
  status: 'RESOLVED' | 'EXPIRED';
}

/**
 * EMERGENCY_LOCATION — SOS-FOLLOW G4, CLIENT → SERVER.
 *
 * What a participant's phone sends while its journey holds an ACTIVE
 * alert. Both participants send it, not only the one who pressed: an
 * emergency on a ride is an emergency for two people, and which of them
 * still has a working phone is not knowable in advance.
 *
 * The server does not trust any of this. It re-checks that the sender is
 * a party to the journey AND that the journey actually holds an ACTIVE
 * alert, and silently drops the frame otherwise — a phone in distress
 * never gets an error loop back.
 */
export interface EmergencyLocationFrame {
  journeyId: string;
  lat: number;
  lng: number;
  accuracy?: number;
}

/**
 * EMERGENCY_LOCATION_UPDATE — SOS-FOLLOW G4, SERVER → THE 'admins' ROOM
 * AND NOWHERE ELSE.
 *
 * This is the only event in the system that carries a live position to
 * anybody who is not on the journey, and the constraint that makes it
 * acceptable is in its delivery, not its shape: `emitToAdmins` only. It
 * is never relayed to a journey room, never to a per-user room, never to
 * the other participant. Nobody can watch a ride; ops can follow an
 * emergency, while that emergency is open.
 */
export interface EmergencyLocationUpdateEvent {
  alertId: string;
  journeyId: string;
  /** Which of the two participants this frame came from. */
  userId: string;
  role: 'CUSTOMER' | 'DRIVER';
  lat: number;
  lng: number;
  accuracy?: number | null;
  /** Server clock, ISO. The ops view prints the age of this, honestly. */
  at: string;
}

// ── NOTIFY G3 payload contracts ───────────────────────────────────
//
// Emitted from services/notification.service.ts, each inside the
// notify* helper that already composes the push for the same event, so
// a caller announces once and reaches both channels. Each is delivered
// by emitToUser to the named recipient's room ONLY.

/** ESCROW_RELEASED — notifyEscrowReleased. To the DRIVER who was paid.
 *
 *  `amount` is what actually lands in his balance (escrow.driverPayout
 *  at the release site), not escrow.amount — the passenger's fare and
 *  the motari's payout are different numbers, and telling him the fare
 *  would be telling him he earned money he did not. */
export interface EscrowReleasedEvent {
  journeyId: string;
  amount: number;
}

/** ESCROW_REFUNDED — notifyEscrowRefunded. To the CUSTOMER refunded. */
export interface EscrowRefundedEvent {
  journeyId: string;
  amount: number;
}

/** RATING_RECEIVED — notifyRatingReceived. To the rated user.
 *  Stars only: no comment, no reason, no rater identity. What an
 *  admin's conflict view reads is not what a toast says. */
export interface RatingReceivedEvent {
  journeyId: string;
  stars: number;
}

/** VERIFICATION_DECIDED — notifyDriverVerification{Approved,Rejected}.
 *  To the DRIVER whose documents were reviewed.
 *
 *  No reason string. The rejection reason is admin free text and can
 *  name a document, a person or a suspicion; it belongs in the SMS and
 *  the push body that helper already sends, addressed to him, not in a
 *  toast that renders on whatever screen he is standing on. */
export interface VerificationDecidedEvent {
  decision: 'APPROVED' | 'REJECTED';
}

/** NO_SHOW_WARNING — notifyDriverNoShowWarning. To the DRIVER warned.
 *  `count` is his own running total, which he is entitled to know. */
export interface NoShowWarningEvent {
  journeyId: string;
  count: number;
}

/** DISPUTE_RESOLVED — notifyDriverDispute{Upheld,Rejected,
 *  ClosedNoAction}. To the DRIVER who raised the dispute.
 *
 *  The outcome only. No admin note, no reviewer identity — the same
 *  posture EMERGENCY_ENDED takes: a participant is told their case is
 *  closed and how, never what an administrator wrote about it. */
export interface DisputeResolvedEvent {
  journeyId: string;
  outcome: 'UPHELD' | 'REJECTED' | 'NO_ACTION';
}

// ── COUNTER-READY G2 payload contracts ────────────────────────────
//
// Emitted from services/notification.service.ts, each inside the notify*
// helper that composes the push for the same event. Delivered by
// emitToUser to the named recipient's room ONLY.

/** BID_COUNTERED — notifyBidCountered. To the DRIVER whose bid it is.
 *
 *  Carries the countered price because that IS the news: he has to
 *  decide on a number, and a toast that made him open a screen to learn
 *  which number would be a worse toast. `originalPrice` is his own bid,
 *  so the two can be shown side by side without a fetch.
 *
 *  No customer name, no phone, no coordinates — the same strip-floor the
 *  six NOTIFY G3 payloads keep. */
export interface BidCounteredEvent {
  journeyId: string;
  bidId: string;
  counterAmountRwf: number;
  originalPrice: number;
}

/** COUNTER_ACCEPTED — notifyCounterAccepted. To the CUSTOMER who
 *  countered. The journey is MATCHED at `agreedPrice` by the time this
 *  is emitted, so the number here is what she will actually be charged,
 *  not what she asked for — they are the same number, and saying the
 *  charged one is the honest way round. */
export interface CounterAcceptedEvent {
  journeyId: string;
  bidId: string;
  agreedPrice: number;
}

/** COUNTER_DECLINED — notifyCounterDeclined. To the CUSTOMER who
 *  countered.
 *
 *  `originalPrice` is the point of the whole event: the motari said no
 *  to her number, and his own offer is STILL THERE at the price he first
 *  named, still acceptable. A decline that did not say so would read as
 *  "this offer is gone", which is false. */
export interface CounterDeclinedEvent {
  journeyId: string;
  bidId: string;
  originalPrice: number;
}
