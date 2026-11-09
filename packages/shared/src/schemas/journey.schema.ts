import { z } from 'zod';
import { JourneyType, JourneyStatus, BookingMode, DeliverySpeed } from '../types/journey.js';
import { VehicleType } from '../types/user.js';
import { KIGALI_BOUNDS, MIN_PRICE_RWF, MAX_PRICE_RWF } from '../constants/config.js';
// HYGIENE W3 G5 — these were declared module-private here, a third copy of
// a rule the server and client already each held. The package designed to
// be the single source now reads it from its own constants.
import { MAX_LEAD_TIME_MS, MIN_LEAD_TIME_MS } from '../constants/time.js';

// FIELD-FIT G3 — the pilot operates inside Kigali, and a booking with a
// point outside it is refused here. The rule is unchanged; only what the
// person is told changes. It used to surface as the raw zod dump —
// "Number must be less than or equal to -1.85" — which is what the team
// meant by booking outside Kigali "gets an error". Tagging the bounds
// with a message key lets middleware/validate.ts answer
// OUTSIDE_OPERATION_AREA, and the client's error presenter renders the
// key in the person's own language with no page changes.
export const OUTSIDE_OPERATION_AREA_KEY = 'errors.outsideOperationArea';

const latSchema = z
  .number()
  .min(KIGALI_BOUNDS.minLat, OUTSIDE_OPERATION_AREA_KEY)
  .max(KIGALI_BOUNDS.maxLat, OUTSIDE_OPERATION_AREA_KEY);
const lngSchema = z
  .number()
  .min(KIGALI_BOUNDS.minLng, OUTSIDE_OPERATION_AREA_KEY)
  .max(KIGALI_BOUNDS.maxLng, OUTSIDE_OPERATION_AREA_KEY);


// R3-LEGS — multi-stop foundation. Schema for an individual leg in
// the optional legs[] array on createJourney. The 20-leg cap on the
// outer array is a generic anti-abuse limit (a journey with 50 stops
// is almost certainly fraud or an input error); R3-POOL-1 will add
// its own concentration cap on active deliveries per vehicle.
export const legInputSchema = z.object({
  type: z.enum([
    'PASSENGER_PICKUP',
    'PASSENGER_DROPOFF',
    'GOODS_PICKUP',
    'GOODS_DROPOFF',
    'WAIT',
  ]),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  name: z.string().min(1).max(200),
  contactName: z.string().min(1).max(100).nullable().optional(),
  contactPhone: z.string().min(1).max(50).nullable().optional(),
  expectedDurationMinutes: z.number().int().min(0).max(240).nullable().optional(),
  // R3-DELIVERY — parcel size for goods stops. Schema is permissive
  // (any leg type may carry it at the schema level); the
  // parcelSize × LegType cross-validation lives in
  // services/legs/legs.service.validateLegSequence so the error code
  // surface (PARCEL_SIZE_REQUIRED_FOR_GOODS_LEG /
  // PARCEL_SIZE_ON_NON_GOODS_LEG) stays canonical.
  parcelSize: z.enum(['SMALL', 'MEDIUM', 'LARGE']).nullable().optional(),
  // R3-DELIVERY-V2 — parcel content category. Optional even on goods
  // legs (UI defaults to OTHER on submit). Forbidden on non-goods legs
  // via PARCEL_CATEGORY_ON_NON_GOODS_LEG in validateLegSequence.
  parcelCategory: z
    .enum(['FOOD', 'ELECTRONICS', 'DOCUMENTS', 'FRAGILE', 'OTHER'])
    .nullable()
    .optional(),
});

export const createJourneySchema = z
  .object({
    type: z.nativeEnum(JourneyType),
    pickupLat: latSchema,
    pickupLng: lngSchema,
    pickupName: z.string().min(1).max(200),
    destinationLat: latSchema,
    destinationLng: lngSchema,
    destinationName: z.string().min(1).max(200),
    // OUTBOX G2 — the client's own name for this booking attempt, so a
    // create can be re-sent without becoming two rides.
    //
    // A booking made in a dead zone is held on the phone and sent when
    // the signal returns. The failure that makes that dangerous is not
    // "the request never arrived" — it is "the request arrived, the row
    // was written, and the 201 died on the way back". The client cannot
    // tell those apart, so without a name for the attempt it must either
    // risk a double booking or risk losing the ride.
    //
    // Pure optional: a body that omits it behaves exactly as before, and
    // an older server simply ignores it. Unique per customer, so the
    // second arrival of the same attempt returns the first one's journey
    // instead of creating another (services/journey.service.ts).
    clientRequestId: z.string().uuid().optional(),
    // LANDMARKS G4 — the passenger's own words about a place, for the
    // places no database knows: "Kuwa Mudugudu", "behind the blue gate".
    // Both are pure optional with no default, so an old client's body
    // still validates and a new client's body still validates against a
    // server that has not deployed this yet — the offline outbox replays
    // in both directions.
    pickupDescription: z.string().max(200).optional(),
    destinationDescription: z.string().max(200).optional(),
    // TEAM-SAID G1 — "Travelling with a child?". One advisory boolean
    // whose only job is to tell the motari before he arrives (item 9;
    // the team confirmed the child-passenger flow stays off 6-to-1 and
    // asked for this signal instead).
    //
    // Deliberately not hasChildPassenger, and deliberately declared far
    // from it: nothing downstream reads this field into
    // childPassengerMultiplier, into services/child-safety/*, or into
    // any of the child 422 codes. Pure optional with no default, so a
    // body that predates the field still validates and the offline
    // outbox replays in both directions.
    travellingWithChild: z.boolean().optional(),
    vehiclePreference: z.nativeEnum(VehicleType).optional(),
    wishPrice: z.number().min(MIN_PRICE_RWF).max(MAX_PRICE_RWF).optional(),
    goodsDescription: z.string().max(500).optional(),
    goodsSizeCategory: z.enum(['SMALL', 'MEDIUM', 'LARGE']).optional(),
    // PARCEL-CATEGORY — what the parcel CONTAINS, asked of the
    // send-a-package sender exactly as the drop-a-package leg flow has
    // asked it since R3-DELIVERY-V2. Same five members, declared with
    // the same shape as the leg-level field above (legInputSchema):
    // enum, nullable, optional.
    //
    // Permissive here on purpose, mirroring parcelSize's split: the
    // schema accepts the value on any journey type and the
    // category × journey-type cross-validation lives in
    // services/journey.service.createJourney, so the error-code surface
    // (PARCEL_CATEGORY_ON_PASSENGER_JOURNEY) stays canonical in one
    // place — the same division legs.service.validateLegSequence uses.
    //
    // Optional with no default: a body that predates this field still
    // validates, an older server ignores the extra key, and the offline
    // outbox replays in both directions. The client defaults to OTHER
    // on submit; the server stores what it is sent and injects nothing.
    parcelCategory: z
      .enum(['FOOD', 'ELECTRONICS', 'DOCUMENTS', 'FRAGILE', 'OTHER'])
      .nullable()
      .optional(),
    // FIELD-FIT G5 — the declared parcel weight, in kilograms. Optional,
    // so every request that was valid before this field existed still
    // is; the vehicle rule it is checked against lives in
    // constants/parcel-weight.ts and is applied in createJourney. The
    // ceiling here is only a sanity bound (the heaviest rule the team
    // set is 70 kg on a bicycle alone).
    goodsWeightKg: z.number().positive().max(200).optional(),
    // TEAM-SAID G3 — delivery speed, exactly two tiers (Jean, item 13).
    // A tier tag, never a price: no branch anywhere multiplies a fare
    // by this field, because the team asked for express to be priced by
    // the same suggest/bid mechanic as everything else rather than by a
    // predetermined surcharge. Optional with no default, so a body that
    // predates the field still validates and NULL stays distinguishable
    // from an explicit STANDARD.
    deliverySpeed: z.nativeEnum(DeliverySpeed).optional(),
    // LIVE-WIRE G5 — Jean's item 13(c). STANDARD may carry an optional
    // 1/2/3-hour window; EXPRESS means now and never carries one. Same
    // guarantee as deliverySpeed above: a tag, never a price. Bounded
    // to the three values the team named rather than a free integer, so
    // "4 hours" cannot arrive from a client that invents one.
    standardDeliveryHours: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
    goodsFragile: z.boolean().optional().default(false),
    recipientName: z.string().max(100).optional(),
    recipientPhone: z.string().optional(),
    bookingMode: z.nativeEnum(BookingMode).optional(),
    scheduledFor: z.string().datetime().optional(),
    // Dispatch K3 — customer modes. WAIT_AND_COMPARE preserves the
    // existing flow; NEED_TO_GO triggers auto-accept of the first
    // qualifying bid within the auto-accept window.
    requestMode: z.enum(['WAIT_AND_COMPARE', 'NEED_TO_GO']).optional(),
    priceCeilingMultiplier: z.number().min(1.0).max(2.0).optional(),
    // R3-CHILD — child-passenger declaration. Validation is performed
    // by services/child-safety/booking-validator on the server (legal
    // age thresholds, helmet confirmation, unaccompanied-minor block);
    // the schema here is permissive shape-only. All fields are pure
    // optional (no .default()) so the existing test surface remains
    // compatible.
    hasChildPassenger: z.boolean().optional(),
    childAgeYears: z.number().int().min(0).max(17).nullable().optional(),
    childIsUnaccompaniedMinor: z.boolean().optional(),
    childGuardianPhone: z.string().min(1).max(50).nullable().optional(),
    childPassengerHelmetConfirmed: z.boolean().optional(),
    // R3-LEGS — optional intermediate stops between pickup and
    // destination. Single-leg journeys (the entirety of pilot v1
    // traffic) omit this field or pass []. Multi-leg journeys are
    // populated by R3-DELIVERY's customer + parcel multi-stop flow.
    legs: z.array(legInputSchema).max(20).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.bookingMode === BookingMode.SCHEDULED) {
      if (!data.scheduledFor) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['scheduledFor'],
          message: 'scheduledFor is required when bookingMode is SCHEDULED',
        });
        return;
      }
      const scheduled = new Date(data.scheduledFor).getTime();
      const now = Date.now();
      if (scheduled - now < MIN_LEAD_TIME_MS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['scheduledFor'],
          message: 'scheduledFor must be at least 1 hour in the future',
        });
      }
      if (scheduled - now > MAX_LEAD_TIME_MS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['scheduledFor'],
          message: 'scheduledFor must be no more than 30 days in the future',
        });
      }
    }
    // Dispatch K3: priceCeilingMultiplier is required when NEED_TO_GO
    // (customer commits with a known number) and rejected otherwise so
    // it can never silently apply to a comparison-shopping journey.
    if (data.requestMode === 'NEED_TO_GO') {
      if (data.priceCeilingMultiplier === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['priceCeilingMultiplier'],
          message: 'priceCeilingMultiplier is required when requestMode is NEED_TO_GO',
        });
      }
    } else if (data.priceCeilingMultiplier !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['priceCeilingMultiplier'],
        message: 'priceCeilingMultiplier must not be set when requestMode is WAIT_AND_COMPARE',
      });
    }
  });

// FEED-SCHEMA — this schema validates GET /api/journeys query strings
// through validate(schema, 'query'), whose parse REPLACES req.query with
// the parsed result. Zod objects strip undeclared keys, so every key the
// route handler reads MUST be declared here or the handler silently never
// sees it (the bug that made every DRIVER-role feed request 400 with
// LOCATION_REQUIRED despite the phone sending lat/lng). A server test
// pins the handler's consumed-key set against this shape.
//
// lat/lng are the driver's live GPS fix, used only for proximity
// filtering — bounded to valid Earth coordinates rather than
// KIGALI_BOUNDS on purpose: a fix just outside the pilot polygon must
// degrade to an empty feed via radius filtering, not 400 the request
// (that would recreate the false-positive class this schema fix
// removes). Query strings arrive as strings, hence z.coerce.
export const journeyQuerySchema = z.object({
  status: z.nativeEnum(JourneyStatus).optional(),
  type: z.nativeEnum(JourneyType).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  viewAs: z.enum(['customer', 'driver']).optional(),
  // RIDES-REACH G1 — the key the rides list has been sending since #156
  // and that nothing has ever declared. Zod strips undeclared keys, so
  // `?history=true` reached the handler as nothing at all: for a
  // CUSTOMER that was harmless (her list is already hers), but for a
  // DRIVER it left the query indistinguishable from a coordinate-less
  // discovery request, which is what threw LOCATION_REQUIRED and made
  // /rides a dead screen for every motari (#205 found the undeclared
  // key; #207 found the dead screen).
  //
  // It means "my rides", not "past rides" — the list is unfiltered by
  // time and partitions client-side (HistoryPage's isUpcomingScheduledRide),
  // and the name is kept because five surfaces and their tests already
  // say it. Read ONLY by the driver arm: the customer arm ignores it,
  // because `customerId: userId` already IS her answer.
  //
  // z.coerce.boolean() is deliberately NOT used: it is truthiness, so
  // `history=false` would coerce to true. The enum accepts the two
  // literal strings a query string can carry and transforms them.
  history: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

// R3-N-1 — cancel reason taxonomy (client-facing). BOTH_NO_SHOW is
// intentionally NOT in CANCEL_REASONS because it is system-derived
// only (R3-N-2 auto-timeout job). Clients never send it.
export const CANCEL_REASONS = [
  'CUSTOMER_CHANGED_MIND',
  'DRIVER_NO_SHOW',
  'DRIVER_LATE',
  'DRIVER_WRONG_VEHICLE',
  'SAFETY_CONCERN',
  'CUSTOMER_NO_SHOW',
  'DRIVER_CAN_NOT_MAKE_IT',
] as const;

export type CancelReasonClient = (typeof CANCEL_REASONS)[number];

export const cancelJourneySchema = z.object({
  reason: z.enum(CANCEL_REASONS).optional(),
});

export type CancelJourneyInput = z.infer<typeof cancelJourneySchema>;

export type CreateJourneyInput = z.infer<typeof createJourneySchema>;
export type JourneyQueryInput = z.infer<typeof journeyQuerySchema>;
// R3-LEGS — re-exported alongside CreateJourneyInput so server code
// can import the runtime schema for its tests + the inferred type
// from the same source. The shared types/leg.ts declares an
// interface-form LegInput too; the schema-inferred type is the
// authoritative shape because Zod is the validator at the API edge.
export type LegInputSchema = z.infer<typeof legInputSchema>;
