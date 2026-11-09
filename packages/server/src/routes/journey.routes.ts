import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
// CUTGUARD v2 G6 — one source of truth for the client's generation.
import { isCurrentApp } from '../middleware/app-version';
import { authMiddleware, driverOnly, customerOnly } from '../middleware/auth';
import {
  createJourneySchema,
  journeyQuerySchema,
  JourneyStatus,
  cancelJourneySchema,
  createRideReportSchema,
  SOCKET_EVENTS,
  EventType,
  JourneyType,
} from '@bimoto/shared';
import { CancelReason, EmergencyAlertStatus } from '@prisma/client';
import * as journeyService from '../services/journey.service';
import * as rideReportService from '../services/ride-report.service';
import { markLegCompleted, markLegActive } from '../services/legs/legs.service';
import * as fairPriceService from '../services/fair-price.service';
import { getReconciliationStatus } from '../services/journey-resilience';
import prisma from '../prisma';
import { tierForCoordinates } from '../services/mobility/tier-classification';
import {
  currentRingForElapsed,
  currentRingForPriority,
  currentRingForUrgent,
} from '../services/discovery/cascade';
import { getNearbyDriverCount } from '../services/discovery/supply';
import { emitToJourney, emitToAdmins, getIO } from '../socket';
import { sendSms } from '../services/sms.service';
import { decryptedPhoneOrNull, decryptedEmergencyContacts } from '../services/user-phone';
import { config } from '../config';
import { estimateMinutes, type EtaMode } from '../services/eta';
import { deriveApproachStatus } from '../services/approach-status';
import { applySuggestUp, getSuggestUpStatus } from '../services/customer-modes/suggest-up';
import {
  AUTO_ACCEPT_WINDOW_SECONDS,
  SUGGEST_UP_VALID_AMOUNTS,
} from '../services/customer-modes/config';

const reconcileSchema = z.object({
  response: z.enum(['ARRIVED_SAFELY', 'NEVER_ARRIVED', 'NEED_HELP']),
  gpsLat: z.number().optional(),
  gpsLng: z.number().optional(),
});

const suggestUpSchema = z.object({
  addRwf: z.number().int().positive(),
});

const router = Router();

/**
 * @openapi
 * /api/journeys:
 *   post:
 *     summary: Create a new journey request (customer only). Supports IMMEDIATE and SCHEDULED bookings.
 *     tags: [Journeys]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [type, pickupLat, pickupLng, pickupName, destinationLat, destinationLng, destinationName]
 *             properties:
 *               type:                { type: string, enum: [PASSENGER, GOODS, PRIORITY_MESSENGER, URGENT_MESSENGER] }
 *               pickupLat:           { type: number, format: float }
 *               pickupLng:           { type: number, format: float }
 *               pickupName:          { type: string, minLength: 1, maxLength: 200 }
 *               destinationLat:      { type: number, format: float }
 *               destinationLng:      { type: number, format: float }
 *               destinationName:     { type: string, minLength: 1, maxLength: 200 }
 *               vehiclePreference:   { type: string, enum: [BIKE, MOTO, E_MOTO, E_BIKE], description: 'Optional. OMIT for any vehicle — the request is then open to every motari in range, whatever he rides, and the driver feed passes it to all of them. Send the key only to narrow the request to one kind of machine.' }
 *               wishPrice:           { type: number }
 *               bookingMode:         { type: string, enum: [IMMEDIATE, SCHEDULED], default: IMMEDIATE }
 *               scheduledFor:        { type: string, format: date-time, description: 'Required when bookingMode = SCHEDULED.' }
 *               hasChildPassenger:           { type: boolean, description: 'R3-CHILD — customer is travelling with a child.' }
 *               childAgeYears:               { type: integer, minimum: 0, maximum: 17, nullable: true }
 *               childIsUnaccompaniedMinor:   { type: boolean, description: 'R3-CHILD — pilot v1 always blocks; reserved for unaccompanied-minor pipeline.' }
 *               childGuardianPhone:          { type: string, nullable: true }
 *               childPassengerHelmetConfirmed: { type: boolean, description: 'R3-CHILD — required for MOTO/E_MOTO + child age <= 12.' }
 *     responses:
 *       201:
 *         description: Created journey.
 *         content:
 *           application/json:
 *             schema: { type: object }
 *       400:
 *         description: Validation failed.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
// POST /api/journeys - create journey (customer only)
router.post('/', authMiddleware, customerOnly, validate(createJourneySchema), async (req, res, next) => {
  try {
    // OUTBOX G2 — a booking held on a phone with no signal is re-sent
    // when the signal returns, carrying the same clientRequestId it was
    // first sent with. If that attempt already produced a journey — most
    // dangerously when it was the RESPONSE that was lost, not the
    // request — hand back the ride that exists instead of booking a
    // second one. 200, not 201: nothing was created here.
    //
    // Nothing changes for a body without the field, which is every body
    // the app sent before this.
    if (req.body.clientRequestId) {
      const existing = await journeyService.findJourneyByClientRequestId(
        req.user!.userId,
        req.body.clientRequestId,
      );
      if (existing) {
        res.status(200).json(existing);
        return;
      }
    }
    const journey = await journeyService.createJourney(req.user!.userId, req.body);
    emitToJourney(journey.id, SOCKET_EVENTS.JOURNEY_CREATED, journey);
    res.status(201).json(journey);
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/journeys/fair-price:
 *   get:
 *     summary: Suggested fair-price band for the given distance (or null if data is sparse).
 *     tags: [Journeys]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: distance
 *         required: true
 *         schema: { type: number, format: float, example: 3.5 }
 *       - in: query
 *         name: vehicleType
 *         required: false
 *         schema: { type: string, enum: [BIKE, MOTO, E_MOTO, E_BIKE] }
 *       - in: query
 *         name: journeyType
 *         required: false
 *         description: R3-PRIORITY — applies the urgency-tier premium (URGENT_MESSENGER=1.3x, PRIORITY_MESSENGER=1.15x). Replaces the legacy isUrgent boolean.
 *         schema: { type: string, enum: [PASSENGER, GOODS, PRIORITY_MESSENGER, URGENT_MESSENGER] }
 *       - in: query
 *         name: isUrgent
 *         required: false
 *         deprecated: true
 *         description: R3-T legacy boolean. Use journeyType=URGENT_MESSENGER instead. When 'true', maps to journeyType=URGENT_MESSENGER for backcompat.
 *         schema: { type: string, enum: [true, false] }
 *       - in: query
 *         name: hasChildPassenger
 *         required: false
 *         description: R3-CHILD — when 'true', applies the 1.1x child-passenger safety premium on top of vehicle and urgency multipliers.
 *         schema: { type: string, enum: [true, false] }
 *       - in: query
 *         name: parcelSize
 *         required: false
 *         description: R3-DELIVERY — when set, applies the parcel-size premium (SMALL=1.0, MEDIUM=1.1, LARGE=1.25) on top of vehicle, urgency, and child multipliers. The 4th compositional fare axis.
 *         schema: { type: string, enum: [SMALL, MEDIUM, LARGE] }
 *     responses:
 *       200:
 *         description: Range payload.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 range:
 *                   nullable: true
 *                   type: object
 *                   properties:
 *                     min:    { type: number }
 *                     median: { type: number }
 *                     max:    { type: number }
 *       400:
 *         description: Distance missing or non-positive.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
// GET /api/journeys/fair-price?distance=3.5&vehicleType=BIKE&journeyType=PRIORITY_MESSENGER — MUST be before /:id
router.get('/fair-price', authMiddleware, async (req, res, next) => {
  try {
    const distance = parseFloat(req.query.distance as string);
    if (isNaN(distance) || distance <= 0) {
      res.status(400).json({ error: { code: 'INVALID_DISTANCE', message: 'errors.invalidDistance' } });
      return;
    }
    const VALID_VEHICLE_TYPES = ['BIKE', 'MOTO', 'E_MOTO', 'E_BIKE'] as const;
    const rawVehicleType = req.query.vehicleType as string | undefined;
    const vehicleType =
      rawVehicleType && (VALID_VEHICLE_TYPES as ReadonlyArray<string>).includes(rawVehicleType)
        ? (rawVehicleType as (typeof VALID_VEHICLE_TYPES)[number])
        : null;
    // R3-PRIORITY — preferred query param. Validated against the
    // urgency-tier subset of JourneyType; PASSENGER / GOODS are also
    // accepted for symmetry but produce a 1.0 multiplier.
    const VALID_JOURNEY_TYPES = [
      'PASSENGER',
      'GOODS',
      'PRIORITY_MESSENGER',
      'URGENT_MESSENGER',
    ] as const;
    const rawJourneyType = (req.query.journeyType as string | undefined)?.trim();
    // R3-T legacy backcompat: if isUrgent=true is passed (R3-T clients
    // not yet migrated), treat as journeyType=URGENT_MESSENGER. Once
    // every client uses journeyType, a future hardening dispatch can
    // remove this fallback.
    const isUrgentLegacy = req.query.isUrgent === 'true';
    const journeyType: (typeof VALID_JOURNEY_TYPES)[number] | null =
      rawJourneyType && (VALID_JOURNEY_TYPES as ReadonlyArray<string>).includes(rawJourneyType)
        ? (rawJourneyType as (typeof VALID_JOURNEY_TYPES)[number])
        : isUrgentLegacy
          ? 'URGENT_MESSENGER'
          : null;
    // R3-CHILD — opt-in child-passenger premium.
    const hasChildPassenger = req.query.hasChildPassenger === 'true';
    // R3-DELIVERY — opt-in parcel-size premium. Validated against the
    // ParcelSize enum; anything else (missing / invalid) falls through
    // as null (multiplier 1.0).
    const VALID_PARCEL_SIZES = ['SMALL', 'MEDIUM', 'LARGE'] as const;
    const rawParcelSize = req.query.parcelSize as string | undefined;
    const parcelSize =
      rawParcelSize && (VALID_PARCEL_SIZES as ReadonlyArray<string>).includes(rawParcelSize)
        ? (rawParcelSize as (typeof VALID_PARCEL_SIZES)[number])
        : null;
    const range = await fairPriceService.getFairPriceRange(
      distance,
      1.0,
      vehicleType,
      journeyType,
      hasChildPassenger,
      parcelSize,
    );
    res.json({ range }); // null if insufficient data
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/journeys:
 *   get:
 *     summary: List journeys visible to the caller, filtered by status / proximity / view.
 *     tags: [Journeys]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *       - in: query
 *         name: type
 *         schema: { type: string }
 *       - in: query
 *         name: lat
 *         schema: { type: number, format: float }
 *       - in: query
 *         name: lng
 *         schema: { type: number, format: float }
 *       - in: query
 *         name: viewAs
 *         schema: { type: string, enum: [customer, driver] }
 *       - in: query
 *         name: history
 *         description: >-
 *           Driver arm only — "my rides". Returns the journeys the caller
 *           is the DRIVER of, needs no coordinates, and is the query the
 *           rides list makes. The customer arm ignores it: her list is
 *           already hers.
 *         schema: { type: string, enum: ['true', 'false'] }
 *     responses:
 *       200:
 *         description: Journey array.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { type: object }
 */
// GET /api/journeys - list journeys (with role, status, lat/lng query params)
router.get('/', authMiddleware, validate(journeyQuerySchema, 'query'), async (req, res, next) => {
  try {
    // RIDES-REACH G1 — `history` is destructured HERE, alongside the
    // other declared keys, rather than read off `req.query` further
    // down: the FEED-SCHEMA structural pin extracts the handler's
    // consumed-key set from exactly this pattern, so a future edit that
    // drops the schema declaration fails a test instead of silently
    // re-creating the stripped-key bug this fix exists to end.
    const { status, type, history } = req.query as any;
    const lat = req.query.lat ? parseFloat(req.query.lat as string) : undefined;
    const lng = req.query.lng ? parseFloat(req.query.lng as string) : undefined;
    const viewAs = req.query.viewAs as 'customer' | 'driver' | undefined;
    // CUTGUARD v2 amendment 2 (B-2 as a class) — the rides list is the
    // second of the three customer commission surfaces. Same source of
    // truth as G6's other gates: `req.appVersion`, parsed once by
    // middleware/app-version.ts. Absent ⇒ legacy ⇒ no preview.
    const journeys = await journeyService.getJourneys(
      req.user!.userId,
      req.user!.role,
      status,
      lat,
      lng,
      viewAs,
      // Already a real boolean by the time it gets here:
      // journeyQuerySchema parses the two literal strings a query string
      // can carry and transforms, and validate(schema, 'query') replaced
      // req.query with that parsed result. The `=== true` is a read, not
      // a coercion.
      history === true,
      { customerSavingsPreview: isCurrentApp(req) },
    );
    res.json(journeys);
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/journeys/{id}/supply:
 *   get:
 *     summary: Real-time "drivers nearby" count for the customer's waiting screen. Privacy floor (N>=3) returns count=null in low-density areas.
 *     tags: [Journeys]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Supply visibility payload for the journey's current cascade ring.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 count:                    { type: integer, nullable: true, description: 'null when below privacy floor.' }
 *                 displayHint:              { type: string, enum: [few, some, many] }
 *                 estimatedFirstBidSeconds: { type: integer, nullable: true }
 *                 currentRingMeters:        { type: integer, description: '-1 means "no radius limit" (SPARSE final ring).' }
 *                 cascadeComplete:          { type: boolean }
 *                 nextRingExpandsAt:        { type: string, format: date-time, nullable: true }
 *       403:
 *         description: Caller is not the customer for this journey.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       404:
 *         description: Journey not found.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
// GET /api/journeys/:id/supply - real-time drivers-nearby count (customer only).
// MUST be before /:id to avoid being captured by the generic single-journey route.
router.get('/:id/supply', authMiddleware, async (req, res, next) => {
  try {
    const journey = await prisma.journey.findUnique({
      where: { id: req.params.id },
    });
    if (!journey) {
      res.status(404).json({ error: { code: 'JOURNEY_NOT_FOUND', message: 'errors.journeyNotFound' } });
      return;
    }
    if (journey.customerId !== req.user!.userId) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'errors.notJourneyCustomer' } });
      return;
    }
    if (journey.status !== JourneyStatus.REQUESTED) {
      res.json({
        count: null,
        displayHint: 'few',
        estimatedFirstBidSeconds: null,
        currentRingMeters: 0,
        cascadeComplete: true,
        nextRingExpandsAt: null,
      });
      return;
    }
    const tier = tierForCoordinates(journey.pickupLat, journey.pickupLng);
    const start = journey.discoveryStartedAt ?? journey.createdAt;
    // R3-PRIORITY — match the journey-type branch shape used by
    // feed-filter so the customer's "drivers nearby" radius reflects
    // the same cascade behaviour the driver feed uses. URGENT jumps
    // straight to the widest ring, PRIORITY uses the half-speed
    // cascade, everything else follows the standard elapsed-time
    // ring expansion.
    const ring =
      journey.type === 'URGENT_MESSENGER'
        ? currentRingForUrgent(tier)
        : journey.type === 'PRIORITY_MESSENGER'
          ? currentRingForPriority(start, tier)
          : currentRingForElapsed(start, tier);
    const supply = await getNearbyDriverCount(
      prisma,
      { lat: journey.pickupLat, lng: journey.pickupLng },
      ring,
    );
    res.json({
      ...supply,
      currentRingMeters: ring.radiusMeters,
      cascadeComplete: ring.isCascadeComplete,
      nextRingExpandsAt: ring.ringEndsAt?.toISOString() ?? null,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/journeys/{id}/suggest-up:
 *   post:
 *     summary: Customer raises their wish-price by a fixed +50 / +100 RWF tier (Dispatch K3 progressive suggest-up).
 *     tags: [Journeys]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [addRwf]
 *             properties:
 *               addRwf: { type: integer, description: 'Must be one of the configured tier amounts (50 or 100 in v1).' }
 *     responses:
 *       200:
 *         description: Updated wish-price.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 newWishPrice:   { type: integer }
 *                 suggestUpCount: { type: integer }
 *       400:
 *         description: Invalid amount, too-early for this tier, or journey already closed.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       403:
 *         description: Caller is not the journey customer.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       404:
 *         description: Journey not found.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post(
  '/:id/suggest-up',
  authMiddleware,
  customerOnly,
  validate(suggestUpSchema),
  async (req, res, next) => {
    try {
      const journeyId = req.params.id;
      const { addRwf } = req.body as { addRwf: number };

      // Cheap bounds check before hitting the service so an obviously
      // bad amount returns 400 with the canonical valid-amounts list.
      if (!SUGGEST_UP_VALID_AMOUNTS.includes(addRwf)) {
        res.status(400).json({
          error: {
            code: 'SUGGEST_UP_INVALID_AMOUNT',
            message: 'errors.suggestUpInvalidAmount',
            validAmounts: [...SUGGEST_UP_VALID_AMOUNTS],
          },
        });
        return;
      }

      const journey = await prisma.journey.findUnique({ where: { id: journeyId } });
      if (!journey) {
        res.status(404).json({
          error: { code: 'JOURNEY_NOT_FOUND', message: 'errors.journeyNotFound' },
        });
        return;
      }
      if (journey.customerId !== req.user!.userId) {
        res.status(403).json({
          error: { code: 'FORBIDDEN', message: 'errors.notJourneyCustomer' },
        });
        return;
      }

      let io = null as ReturnType<typeof getIO> | null;
      try {
        io = getIO();
      } catch {
        // Socket.io not initialised — proceed without live emit.
      }

      try {
        const result = await applySuggestUp(
          prisma,
          io,
          journeyId,
          req.user!.userId,
          addRwf,
        );
        res.json(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.startsWith('SUGGEST_UP_INVALID:')) {
          const reason = msg.split(':')[1];
          res.status(400).json({
            error: { code: 'SUGGEST_UP_INVALID', message: `errors.suggestUp.${reason}`, reason },
          });
          return;
        }
        throw err;
      }
    } catch (err) {
      next(err);
    }
  },
);

/**
 * @openapi
 * /api/journeys/{id}/customer-mode-status:
 *   get:
 *     summary: Returns the K3 customer-mode state for a journey — request mode, locked ceiling, suggest-up tier availability, auto-accept window end.
 *     tags: [Journeys]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Customer-mode status payload.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 requestMode:               { type: string, enum: [WAIT_AND_COMPARE, NEED_TO_GO] }
 *                 priceCeilingRwf:           { type: integer, nullable: true }
 *                 priceCeilingMultiplier:    { type: number, nullable: true }
 *                 autoAcceptWindowEndsAt:    { type: string, format: date-time, nullable: true }
 *                 suggestUpStatus:
 *                   type: object
 *                   properties:
 *                     availableAmounts:      { type: array, items: { type: integer } }
 *                     alreadyTakenCount:     { type: integer }
 *                     nextAmountAvailableAt: { type: string, format: date-time, nullable: true }
 *       403:
 *         description: Caller is not the journey customer.
 *       404:
 *         description: Journey not found.
 */
router.get('/:id/customer-mode-status', authMiddleware, async (req, res, next) => {
  try {
    const journey = await prisma.journey.findUnique({ where: { id: req.params.id } });
    if (!journey) {
      res.status(404).json({
        error: { code: 'JOURNEY_NOT_FOUND', message: 'errors.journeyNotFound' },
      });
      return;
    }
    if (journey.customerId !== req.user!.userId) {
      res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'errors.notJourneyCustomer' },
      });
      return;
    }
    const start = journey.discoveryStartedAt ?? journey.createdAt;
    const autoAcceptWindowEndsAt = start
      ? new Date(start.getTime() + AUTO_ACCEPT_WINDOW_SECONDS * 1000)
      : null;
    const suggestUpStatus = getSuggestUpStatus({
      discoveryStartedAt: start,
      suggestUpCount: journey.suggestUpCount ?? 0,
    });
    res.json({
      requestMode: journey.requestMode,
      priceCeilingRwf: journey.priceCeilingRwf,
      priceCeilingMultiplier: journey.priceCeilingMultiplier,
      autoAcceptWindowEndsAt: autoAcceptWindowEndsAt
        ? autoAcceptWindowEndsAt.toISOString()
        : null,
      suggestUpStatus: {
        availableAmounts: suggestUpStatus.availableAmounts,
        alreadyTakenCount: suggestUpStatus.alreadyTakenCount,
        nextAmountAvailableAt: suggestUpStatus.nextAmountAvailableAt
          ? suggestUpStatus.nextAmountAvailableAt.toISOString()
          : null,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/journeys/{id}:
 *   get:
 *     summary: Fetch a single journey (with bids, messages, GPS, escrow).
 *     tags: [Journeys]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Journey detail.
 *         content:
 *           application/json:
 *             schema: { type: object }
 *       404:
 *         description: Journey not found.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
// GET /api/journeys/:id - get single journey, projected to the viewer.
//
// INCLUDE-REACH G4 — the service decides HOW MUCH of the journey this caller
// may see (journey.service.journeyViewerScope); this route decides whether
// they may see it AT ALL. The split is deliberate: two other handlers in this
// file call getJourneyById and answer an outsider with 403 after their own
// participation test, and a 404 thrown down in the service would have
// rewritten both of them.
//
// An outsider — not the customer, not the matched driver, and past the point
// where the journey was open to bids — gets the 404 the journey family gives
// a resource it will not confirm the existence of. A driver looking at a
// journey that is still REQUESTED is NOT an outsider: that is the bid screen,
// and it keeps working (BidPage.tsx:56), on a projection that no longer
// carries the chat, the escrow row, or anybody's phone number.
router.get('/:id', authMiddleware, async (req, res, next) => {
  try {
    // CUTGUARD v2 amendment 2 (B-2 as a class) — the journey read is the
    // first of the three customer commission surfaces, and the one with
    // the worst reach: MatchedPage, the screen she sits on for the whole
    // ride. Gated on the same `req.appVersion` as every other G6 gate.
    const journey = await journeyService.getJourneyById(req.params.id, req.user!.userId, {
      customerSavingsPreview: isCurrentApp(req),
    });
    if (journeyService.journeyViewerScope(req.user!.userId, journey) === 'outsider') {
      res.status(404).json({
        error: { code: 'JOURNEY_NOT_FOUND', message: 'errors.journeyNotFound' },
      });
      return;
    }
    res.json(journey);
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/journeys/{id}/eta:
 *   get:
 *     summary: Estimated time-of-arrival for the matched driver, computed from the most recent GPS point.
 *     description: Authenticated journey parties only. Returns minutes:null when no GPS point has been received yet.
 *     tags: [Journeys]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: ETA estimate (minutes:null when GPS unavailable).
 *       403:
 *         description: Caller is not a party to the journey.
 *       404:
 *         description: Journey not found.
 */
// GET /api/journeys/:id/eta - compute ETA from latest GpsPoint (driver/customer only)
router.get('/:id/eta', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const journey = await prisma.journey.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        customerId: true,
        driverId: true,
        pickupLat: true,
        pickupLng: true,
        driver: { select: { driverProfile: { select: { vehicleType: true } } } },
      },
    });
    if (!journey) return res.status(404).json({ message: 'Journey not found' });
    if (journey.customerId !== userId && journey.driverId !== userId) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    // R3-N-3 — fetch the last 5 GPS points (oldest first) so the
    // approach-status helper can inspect a short distance vector,
    // not just the latest point.
    const recentDesc = await prisma.gpsPoint.findMany({
      where: { journeyId: journey.id },
      orderBy: { timestamp: 'desc' },
      take: 5,
      select: { lat: true, lng: true, timestamp: true },
    });
    const points = [...recentDesc].reverse();
    const now = new Date();
    const approach = deriveApproachStatus(
      points,
      journey.pickupLat,
      journey.pickupLng,
      now,
    );

    if (points.length === 0) {
      return res.json({
        minutes: null,
        confidence: 'unknown',
        asOf: null,
        approachStatus: approach.status,
        distanceMeters: null,
      });
    }

    const latest = points[points.length - 1];
    const vehicleType = (journey.driver?.driverProfile?.vehicleType ?? 'MOTO') as string;
    const VALID_ETA_MODES: ReadonlyArray<EtaMode> = ['BIKE', 'MOTO', 'E_MOTO', 'E_BIKE', 'CAR'];
    const mode: EtaMode = (VALID_ETA_MODES as ReadonlyArray<string>).includes(vehicleType)
      ? (vehicleType as EtaMode)
      : 'MOTO';
    const eta = estimateMinutes(latest.lat, latest.lng, journey.pickupLat, journey.pickupLng, mode);

    return res.json({
      minutes: eta.minutes,
      confidence: eta.confidence,
      asOf: latest.timestamp.toISOString(),
      approachStatus: approach.status,
      distanceMeters: approach.distanceMeters,
    });
  } catch (err) {
    next(err);
    return undefined;
  }
});

/**
 * @openapi
 * /api/journeys/{id}/start:
 *   post:
 *     summary: Driver marks the journey as started (transitions MATCHED → IN_PROGRESS).
 *     tags: [Journeys]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [lat, lng]
 *             properties:
 *               lat: { type: number, format: float }
 *               lng: { type: number, format: float }
 *     responses:
 *       200:
 *         description: Updated journey.
 *         content:
 *           application/json:
 *             schema: { type: object }
 */
// POST /api/journeys/:id/start - start journey (driver only)
router.post('/:id/start', authMiddleware, driverOnly, async (req, res, next) => {
  try {
    const { lat, lng } = req.body;
    const journey = await journeyService.startJourney(req.params.id, req.user!.userId, lat, lng);
    emitToJourney(journey.id, SOCKET_EVENTS.JOURNEY_STARTED, journey);
    res.json(journey);
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/journeys/{id}/end:
 *   post:
 *     summary: Driver marks the journey complete (IN_PROGRESS → AWAITING_CONFIRMATION).
 *     tags: [Journeys]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [lat, lng]
 *             properties:
 *               lat: { type: number, format: float }
 *               lng: { type: number, format: float }
 *     responses:
 *       200:
 *         description: Updated journey.
 */
// POST /api/journeys/:id/end - end journey (driver only)
router.post('/:id/end', authMiddleware, driverOnly, async (req, res, next) => {
  try {
    const { lat, lng } = req.body;
    const journey = await journeyService.endJourney(req.params.id, req.user!.userId, lat, lng);
    emitToJourney(journey.id, SOCKET_EVENTS.JOURNEY_ENDED, journey);
    res.json(journey);
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/journeys/{id}/confirm:
 *   post:
 *     summary: Customer confirms successful delivery; releases escrow to driver.
 *     tags: [Journeys]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Updated journey (status COMPLETED).
 */
// POST /api/journeys/:id/confirm - confirm journey (customer only)
router.post('/:id/confirm', authMiddleware, customerOnly, async (req, res, next) => {
  try {
    const journey = await journeyService.confirmJourney(req.params.id, req.user!.userId);
    emitToJourney(journey.id, SOCKET_EVENTS.JOURNEY_CONFIRMED, journey);
    res.json(journey);
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/journeys/{id}/dispute:
 *   post:
 *     summary: Customer raises a dispute; freezes escrow for admin review.
 *     tags: [Journeys]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason: { type: string }
 *     responses:
 *       200:
 *         description: Updated journey (status DISPUTED).
 */
// POST /api/journeys/:id/dispute - dispute journey (customer only)
router.post('/:id/dispute', authMiddleware, customerOnly, async (req, res, next) => {
  try {
    const { reason } = req.body;
    const journey = await journeyService.disputeJourney(req.params.id, req.user!.userId, reason || '');
    emitToJourney(journey.id, SOCKET_EVENTS.JOURNEY_DISPUTED, journey);
    res.json(journey);
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/journeys/{id}/report:
 *   post:
 *     summary: >-
 *       Driver files an incident report about a ride they drove. An
 *       incident, not a grade — passengers are never scored.
 *     tags: [Journeys]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reason]
 *             properties:
 *               reason:
 *                 type: string
 *                 enum: [NO_SHOW_OR_LATE, RUDE_BEHAVIOUR, REFUSED_AGREED_PRICE, UNSAFE_REQUEST, OTHER]
 *               details: { type: string, maxLength: 500 }
 *     responses:
 *       201:
 *         description: The filed report.
 *       403:
 *         description: Caller is not the driver of this journey.
 *       409:
 *         description: This driver has already reported this journey.
 */
// POST /api/journeys/:id/report — TEAM-ANSWERS G3 (item 15, driver side)
//
// The driver's half of "identify and manage issues from both sides",
// shipped as an incident report rather than a passenger rating. The row
// carries a reason, optional details and the journey; the admin sees who
// the customer was THROUGH the journey, as with every other conflict
// type. No stars, no score, no per-customer aggregate.
router.post(
  '/:id/report',
  authMiddleware,
  driverOnly,
  validate(createRideReportSchema),
  async (req, res, next) => {
    try {
      const report = await rideReportService.createRideReport(
        req.params.id,
        req.user!.userId,
        req.body.reason,
        req.body.details,
      );
      res.status(201).json(report);
    } catch (err) { next(err); }
  },
);

/**
 * @openapi
 * /api/journeys/{id}/interrupt:
 *   post:
 *     summary: Customer interrupts a journey mid-trip; freezes escrow for admin review.
 *     tags: [Journeys]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [lat, lng]
 *             properties:
 *               lat:    { type: number, format: float }
 *               lng:    { type: number, format: float }
 *               reason: { type: string }
 *     responses:
 *       200:
 *         description: Updated journey (status INTERRUPTED).
 */
// POST /api/journeys/:id/interrupt - interrupt journey (customer only)
router.post('/:id/interrupt', authMiddleware, customerOnly, async (req, res, next) => {
  try {
    const { lat, lng, reason } = req.body;
    const journey = await journeyService.interruptJourney(req.params.id, req.user!.userId, lat, lng, reason);
    emitToJourney(journey.id, SOCKET_EVENTS.JOURNEY_INTERRUPTED, journey);
    res.json(journey);
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/journeys/{id}/emergency:
 *   post:
 *     summary: A journey participant (customer or matched driver) fires an emergency alert; broadcast to participants via socket.
 *     tags: [Journeys]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               lat: { type: number, format: float }
 *               lng: { type: number, format: float }
 *     responses:
 *       200:
 *         description: Alert recorded and fanned out; `channels` reports the per-channel outcome.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 message: { type: string }
 *                 alertId: { type: string, format: uuid, description: The ACTIVE EmergencyAlert this press opened or joined. Absent if the state row could not be written. }
 *                 recorded: { type: boolean }
 *                 smsSuppressed: { type: boolean }
 *                 channels: { type: object }
 *       403:
 *         description: Caller is neither the journey's customer nor its matched driver.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
// SOS-WIRE G1 — repeated POSTs for the same journey inside this window
// still record + re-emit sockets, but do NOT re-send SMS (storm guard).
const EMERGENCY_SMS_GUARD_WINDOW_MS = 10 * 60 * 1000;

// POST /api/journeys/:id/emergency - emergency alert (journey participant).
// SOS-WIRE G1 fan-out: record (SyncEvent) → journey-room socket →
// admins-room socket → ops SMS → emergency-contact SMS. Every channel
// is individually try/caught: one failing channel never blocks the
// others, and the response reports what succeeded.
//
// RED-BUTTON G2 — the motari presses the same button his passenger has.
// The route, the channels and the response shape are untouched (deployed
// APKs keep working); what changed is that "own" is now resolved by role:
//
//   * the gate is participation, not role. customerOnly is gone —
//     a DRIVER role could never have passed it, and it said nothing
//     about THIS journey anyway. The caller must be the journey's
//     customer or its matched driver; anyone else still gets 403.
//   * the contact SMS goes to the CALLER's own emergency contacts.
//     A driver's alert never texts the passenger's family, nor the
//     reverse — the two lists are read from two different users.
//   * the alert describes the COUNTERPART, because that is the person
//     ops (and the caller's family) cannot otherwise identify: a
//     passenger's alert names the motari and his plate, a motari's
//     alert names the passenger and, when the position stream holds
//     one, his own last known GPS.
//
// The admin payload keeps rider* meaning THE PASSENGER in both
// directions — the admin banner reads those fields and is untouched —
// and gains raisedBy plus the driver-side fields.
router.post('/:id/emergency', authMiddleware, async (req, res, next) => {
  try {
    const journey = await journeyService.getJourneyById(req.params.id, req.user!.userId);
    const callerId = req.user!.userId;
    const callerIsCustomer = journey.customerId === callerId;
    // An unmatched journey has no driver, so no driver can be a
    // participant in it — such a caller falls through to the 403.
    const callerIsDriver = !!journey.driverId && journey.driverId === callerId;
    if (!callerIsCustomer && !callerIsDriver) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'errors.notJourneyParticipant' } });
      return;
    }
    const raisedBy: 'CUSTOMER' | 'DRIVER' = callerIsCustomer ? 'CUSTOMER' : 'DRIVER';

    // LOOSE-ENDS G3 — WHAT is being carried, alongside WHO pressed.
    //
    // Read off the journey row this handler already loaded; no extra
    // query. The test is `!== PASSENGER`, never `=== GOODS`:
    // JourneyType has four members and three of them (GOODS,
    // PRIORITY_MESSENGER, URGENT_MESSENGER) are parcels, so branching
    // on GOODS alone would still tell an urgent-messenger run's family
    // that their man is on a ride.
    const journeyType = journey.type as JourneyType | undefined;
    const isParcelJourney = journeyType !== undefined && journeyType !== JourneyType.PASSENGER;

    const journeyId = req.params.id;
    const timestamp = new Date().toISOString();
    const lat = typeof req.body?.lat === 'number' ? req.body.lat : undefined;
    const lng = typeof req.body?.lng === 'number' ? req.body.lng : undefined;

    // Rider identity for the SMS bodies and the admin payload. Phone is
    // stored encrypted; a decrypt failure degrades to 'unknown', never
    // blocks the alert.
    let riderPhone: string | null = null;
    let riderNickname: string | null = null;
    let riderContacts: string[] = [];
    try {
      const rider = await prisma.user.findUnique({
        where: { id: journey.customerId },
        select: { phoneEncrypted: true, nickname: true, emergencyContactsEncrypted: true },
      });
      if (rider) {
        riderNickname = rider.nickname;
        riderPhone = decryptedPhoneOrNull(rider);
        riderContacts = decryptedEmergencyContacts(rider);
      }
    } catch (err) {
      console.error('[EMERGENCY] Failed to load rider record:', err);
    }

    // RED-BUTTON G2 — the motari's side of the same record. Loaded
    // whenever the journey has a matched driver: a passenger's alert
    // needs his identity and plate for the alert body, and his own
    // alert needs his contacts and his last known position. Same
    // degradation rules as the rider read — never blocks the alert.
    let driverPhone: string | null = null;
    let driverNickname: string | null = null;
    let driverPlate: string | null = null;
    let driverContacts: string[] = [];
    let driverLastLat: number | null = null;
    let driverLastLng: number | null = null;
    if (journey.driverId) {
      try {
        const driver = await prisma.user.findUnique({
          where: { id: journey.driverId },
          select: {
            phoneEncrypted: true,
            nickname: true,
            emergencyContactsEncrypted: true,
            driverProfile: { select: { registrationPlate: true, lastLat: true, lastLng: true } },
          },
        });
        if (driver) {
          driverNickname = driver.nickname;
          driverPhone = decryptedPhoneOrNull(driver);
          driverContacts = decryptedEmergencyContacts(driver);
          driverPlate = driver.driverProfile?.registrationPlate ?? null;
          driverLastLat = driver.driverProfile?.lastLat ?? null;
          driverLastLng = driver.driverProfile?.lastLng ?? null;
        }
      } catch (err) {
        console.error('[EMERGENCY] Failed to load driver record:', err);
      }
    }

    // The caller's OWN people are the ones who get told. This single
    // choice is what keeps the two directions from crossing.
    const emergencyContacts = callerIsCustomer ? riderContacts : driverContacts;

    // A motari's alert carries his last known position when the phone
    // did not send one with the POST — the position stream is often the
    // only thing left when somebody cannot type.
    const alertLat = lat ?? (callerIsDriver ? driverLastLat ?? undefined : undefined);
    const alertLng = lng ?? (callerIsDriver ? driverLastLng ?? undefined : undefined);

    // SOS-FOLLOW G2 — the press additionally makes the emergency a STATE.
    //
    // Everything above and below this block is untouched: the SyncEvent
    // record, all four fan-out channels, the storm guard and the
    // response's existing fields are byte-identical to what RED-BUTTON
    // shipped. What is added is one row that can be asked a question an
    // event log cannot answer — "is this journey in an emergency right
    // now" — which is the permission the follow stream checks and the
    // thing an admin later closes.
    //
    // ONE ACTIVE ROW PER JOURNEY. A second press is the same emergency,
    // not a new one: it still re-records the SyncEvent and still
    // re-emits every channel (that IS the repeated alarm, and it is
    // unchanged), but it reuses the ACTIVE row rather than opening a
    // second permission for ops to close. The database enforces this
    // too, with a partial unique index; this read-then-create is the
    // service-level half of the same rule.
    //
    // Individually try/caught, like every other channel in this handler
    // and for the same reason: an emergency that cannot write a row must
    // still ring every phone it was going to ring. A failure here leaves
    // alertId undefined and costs the live follow, never the alarm.
    let alertId: string | undefined;
    try {
      const existing = await prisma.emergencyAlert.findFirst({
        where: { journeyId, status: EmergencyAlertStatus.ACTIVE },
      });
      if (existing) {
        alertId = existing.id;
      } else {
        const created = await prisma.emergencyAlert.create({
          data: {
            journeyId,
            raisedById: callerId,
            raisedByRole: raisedBy,
            // The position the alert actually carries, which for a
            // motari with no POST body coords is his last known one.
            // Nullable throughout: no position is a normal alert.
            pressLat: alertLat ?? null,
            pressLng: alertLng ?? null,
          },
        });
        alertId = created.id;
      }
    } catch (err) {
      console.error('[EMERGENCY] Failed to open/read the alert state row:', err);
    }

    // SMS storm guard: a persisted EMERGENCY_ALERT for this journey
    // inside the window means the SMS channels already fired.
    //
    // RED-BUTTON G2 — the guard key is (journeyId, EMERGENCY_ALERT,
    // userId = the caller). Scoping it to the caller is the whole
    // point: a passenger's alert must not silence the SMS of his
    // motari's alert three minutes later. Both participants are
    // distinct users, so per-caller IS per-role here, and a passenger
    // re-pressing his own button is suppressed exactly as before.
    let smsSuppressed = false;
    try {
      const recent = await prisma.syncEvent.findFirst({
        where: {
          journeyId,
          eventType: EventType.EMERGENCY_ALERT,
          userId: callerId,
          serverTimestamp: { gte: new Date(Date.now() - EMERGENCY_SMS_GUARD_WINDOW_MS) },
        },
      });
      smsSuppressed = recent !== null;
    } catch (err) {
      console.error('[EMERGENCY] Guard lookup failed (continuing as first alert):', err);
    }

    // Record the emergency. SyncEvent is the established event ledger
    // for this eventType (the client sync path persists uploaded
    // EMERGENCY_ALERT events to the same table) and doubles as the
    // guard above — no schema change needed.
    let recorded = false;
    try {
      await prisma.syncEvent.create({
        data: {
          // The caller, not the journey's customer — this row IS the
          // storm-guard key, so it has to name who pressed the button.
          // For a passenger's alert the two are the same value.
          userId: callerId,
          journeyId,
          eventType: EventType.EMERGENCY_ALERT,
          payload: {
            lat: alertLat ?? null,
            lng: alertLng ?? null,
            source: 'emergency-endpoint',
            raisedBy,
          },
          clientTimestamp: new Date(),
          clientEventId: `emergency-${journeyId}-${Date.now()}`,
        },
      });
      recorded = true;
    } catch (err) {
      console.error('[EMERGENCY] Failed to record emergency event:', err);
    }

    // Channel 1 — journey room (customer + driver). Payload unchanged
    // from the pre-SOS-WIRE emit apart from the additive raisedBy: no
    // phone number reaches the room, in either direction.
    let journeyRoomEmitted = false;
    try {
      emitToJourney(journeyId, SOCKET_EVENTS.EMERGENCY_ALERT, {
        journeyId,
        // SOS-FOLLOW G2 — the other participant's device learns the
        // alert's identity here, which is how it knows to start its own
        // follow stream without having pressed anything. No position
        // beyond the press coords this event has always carried.
        alertId,
        userId: callerId,
        raisedBy,
        // LOOSE-ENDS G3 — the in-ride toast reads this to say "parcel
        // run" instead of "ride". Still no phone number in this room.
        journeyType,
        lat: alertLat,
        lng: alertLng,
        timestamp,
      });
      journeyRoomEmitted = true;
    } catch (err) {
      console.error('[EMERGENCY] Journey-room emit failed:', err);
    }

    // Channel 2 — admins room (persistent banner in the admin shell).
    let adminEmitted = false;
    try {
      emitToAdmins(SOCKET_EVENTS.EMERGENCY_ALERT, {
        journeyId,
        // SOS-FOLLOW G2 — the ops list keys its live follow on this.
        alertId,
        userId: callerId,
        // rider* keeps meaning THE PASSENGER in both directions: the
        // admin banner reads these fields and stays as it is. Who
        // actually pressed the button is raisedBy.
        riderNickname: riderNickname ?? undefined,
        riderPhone,
        raisedBy,
        // LOOSE-ENDS G3 — the admin banner branches on this exactly as
        // it branches on raisedBy above.
        journeyType,
        driverNickname: driverNickname ?? undefined,
        driverPhone,
        driverPlate,
        lat: alertLat,
        lng: alertLng,
        timestamp,
      });
      adminEmitted = true;
    } catch (err) {
      console.error('[EMERGENCY] Admins-room emit failed:', err);
    }

    // SMS copy — deliberately bilingual (en + rw) in ONE message for the
    // pilot: recipient language is unknown and a second SMS per contact
    // doubles cost and delay. Contains journey id + the caller's phone.
    //
    // RED-BUTTON G2 — each body names the COUNTERPART, because that is
    // the person the reader cannot otherwise identify. Ops gets the
    // counterpart's phone (Bimoto staff have to be able to call both
    // sides); the caller's own contacts get the counterpart's name and
    // plate, which is what tells a family who their person is with,
    // without spreading a stranger's number to private phones.
    const motariTail =
      driverNickname || driverPlate || driverPhone
        ? ` Motari: ${driverNickname ?? 'unknown'}` +
          (driverPlate ? ` (plate ${driverPlate})` : '') + '.'
        : '';
    // LOOSE-ENDS G3 — the journey-kind vocabulary, in one place so both
    // bodies say the same thing.
    //
    // Two separate corrections land here, and they are worth naming
    // apart:
    //
    //   1. WHAT KIND OF JOURNEY. Every body said "during a ride / mu
    //      rugendo" and named the customer a passenger, on a parcel run
    //      as readily as on a ride. A sender's family read that their
    //      person was riding somewhere with a stranger; a motari's
    //      family read that he was carrying a passenger who does not
    //      exist. `isParcelJourney` covers all three parcel members of
    //      JourneyType, not GOODS alone.
    //
    //   2. THE BANNED WORD. TRUE-WORDS retired "rider" in favour of
    //      "passenger" (docs/wording-reconciliation.md §3.1) and swept
    //      the client locales, where zero occurrences remain. These
    //      bodies are hardcoded server-side and were outside that
    //      sweep, so "Rider needs help", the "Rider:" label and "A
    //      rider" survived in the one channel that reaches a family's
    //      phone. All three are corrected here. The Kinyarwanda was
    //      already right ("Umugenzi").
    const counterpartLabel = isParcelJourney ? 'Sender' : 'Passenger';
    const customerNeedsHelp = isParcelJourney
      ? `Parcel sender needs help / Uwohereza umuzigo akeneye ubufasha.`
      : `Passenger needs help / Umugenzi akeneye ubufasha.`;
    const duringWhat = isParcelJourney
      ? `during a parcel delivery / yakanze buto y'ubutabazi mu gutwara umuzigo.`
      : `during a ride / yakanze buto y'ubutabazi mu rugendo.`;
    const anonymousCustomer = isParcelJourney ? 'A parcel sender' : 'A passenger';

    const opsSmsBody =
      raisedBy === 'DRIVER'
        ? `BIMOTO SOS - Motari needs help / Umumotari akeneye ubufasha. ` +
          (isParcelJourney ? `Carrying a parcel / Atwaye umuzigo. ` : '') +
          `Motari: ${driverPhone ?? 'unknown'}` +
          (driverPlate ? ` (plate ${driverPlate})` : '') + `. ` +
          `${counterpartLabel}: ${riderNickname ?? 'unknown'} (${riderPhone ?? 'unknown'}). ` +
          `Journey: ${journeyId}. ` +
          (journey.pickupName || journey.destinationName
            ? `Route: ${journey.pickupName ?? '?'} - ${journey.destinationName ?? '?'}. `
            : '') +
          (alertLat !== undefined && alertLng !== undefined
            ? `Last GPS: ${alertLat}, ${alertLng}. `
            : '') +
          `Call now / Hamagara nonaha.`
        : `BIMOTO SOS - ${customerNeedsHelp} ` +
          `${counterpartLabel}: ${riderPhone ?? 'unknown'}. Journey: ${journeyId}.` +
          motariTail + ` ` +
          `Call now / Hamagara nonaha.`;
    const contactSmsBody =
      raisedBy === 'DRIVER'
        ? `BIMOTO SOS - ${driverNickname ?? 'A motari'} (${driverPhone ?? 'unknown'}) ` +
          `pressed the emergency button ${duringWhat} ` +
          `${counterpartLabel}: ${riderNickname ?? 'unknown'}. Journey: ${journeyId}. ` +
          `Please call them now / Muhamagare nonaha.`
        : `BIMOTO SOS - ${riderNickname ?? anonymousCustomer} (${riderPhone ?? 'unknown'}) ` +
          `pressed the emergency button ${duringWhat} ` +
          `Journey: ${journeyId}.` + motariTail + ` ` +
          `Please call them now / Muhamagare nonaha.`;

    // Channel 3 — ops phone.
    let opsSms: 'sent' | 'failed' | 'skipped-unset' | 'suppressed' = 'suppressed';
    if (!smsSuppressed) {
      if (!config.EMERGENCY_OPS_PHONE) {
        console.warn('[EMERGENCY] EMERGENCY_OPS_PHONE is unset — ops SMS channel skipped');
        opsSms = 'skipped-unset';
      } else {
        try {
          await sendSms(config.EMERGENCY_OPS_PHONE, opsSmsBody);
          opsSms = 'sent';
        } catch (err) {
          console.error('[EMERGENCY] Ops SMS failed:', err);
          opsSms = 'failed';
        }
      }
    }

    // Channel 4 — the CALLER's own stored emergency contacts (0–3),
    // each send individually guarded. Never the counterpart's list.
    const contactSms = { total: emergencyContacts.length, sent: 0, failed: 0 };
    if (!smsSuppressed) {
      for (const contact of emergencyContacts) {
        try {
          await sendSms(contact, contactSmsBody);
          contactSms.sent++;
        } catch (err) {
          console.error(`[EMERGENCY] Contact SMS to ${contact} failed:`, err);
          contactSms.failed++;
        }
      }
    }

    res.json({
      success: true,
      message: 'Emergency alert sent',
      // SOS-FOLLOW G2 — additive. The raiser's own device reads this to
      // start streaming immediately, without waiting for the socket
      // round-trip. Undefined if the state row could not be written,
      // which every existing field above is deliberately unaffected by.
      alertId,
      recorded,
      smsSuppressed,
      channels: {
        journeyRoom: journeyRoomEmitted,
        adminAlert: adminEmitted,
        opsSms,
        contactSms,
      },
    });
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/journeys/{id}/emergency/active:
 *   get:
 *     summary: The journey's ACTIVE emergency alert, or null. Journey participants only.
 *     tags: [Journeys]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: "The ACTIVE alert, or a null `alert` when the journey holds none."
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 alert:
 *                   nullable: true
 *                   type: object
 *                   properties:
 *                     id: { type: string, format: uuid }
 *                     journeyId: { type: string, format: uuid }
 *                     raisedByRole: { type: string, enum: [CUSTOMER, DRIVER] }
 *                     createdAt: { type: string, format: date-time }
 *       403:
 *         description: Caller is neither the journey's customer nor its matched driver.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
// GET /api/journeys/:id/emergency/active — SOS-FOLLOW G2.
//
// The remount truth. `notifyState` in EmergencySOS is component state:
// it does not survive a navigation, a backgrounded app or a restart, so
// after any of those the phone of somebody in an emergency had no idea
// it was in one. This endpoint is the server's answer to that question,
// and it OUTRANKS whatever the device believes — a device that thinks
// an alert is live when the server says it is closed stops streaming,
// and a device that has forgotten resumes.
//
// Deliberately thin. It answers "is this journey in an emergency, and
// which one" and nothing else: no positions, no phone numbers, no
// counterpart identity. Everything ops needs lives behind adminOnly;
// what a participant gets is the one bit their own app needs to behave
// correctly about their own journey.
//
// Same participation gate as the press itself — an outsider gets the
// same 403, from the same shape of check.
router.get('/:id/emergency/active', authMiddleware, async (req, res, next) => {
  try {
    const journey = await journeyService.getJourneyById(req.params.id, req.user!.userId);
    const callerId = req.user!.userId;
    const callerIsCustomer = journey.customerId === callerId;
    const callerIsDriver = !!journey.driverId && journey.driverId === callerId;
    if (!callerIsCustomer && !callerIsDriver) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'errors.notJourneyParticipant' } });
      return;
    }

    const alert = await prisma.emergencyAlert.findFirst({
      where: { journeyId: req.params.id, status: EmergencyAlertStatus.ACTIVE },
      select: { id: true, journeyId: true, raisedByRole: true, createdAt: true },
    });
    res.json({ alert: alert ?? null });
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/journeys/{id}/cancel:
 *   post:
 *     summary: Cancel an instant journey (customer or driver, role-dependent rules).
 *     tags: [Journeys]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Updated journey (status CANCELLED).
 */
// POST /api/journeys/:id/cancel - cancel journey. R3-N-1: validates an
// optional `reason` body field; defaults to CUSTOMER_CHANGED_MIND for
// backward compatibility with old clients still POSTing without a body.
router.post('/:id/cancel', authMiddleware, validate(cancelJourneySchema), async (req, res, next) => {
  try {
    const reason =
      ((req.body?.reason as CancelReason | undefined) ??
        CancelReason.CUSTOMER_CHANGED_MIND);
    const journey = await journeyService.cancelJourney(
      req.params.id,
      req.user!.userId,
      reason,
    );
    emitToJourney(journey.id, SOCKET_EVENTS.JOURNEY_CANCELLED, journey);
    res.json(journey);
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/journeys/{id}/redispatch:
 *   post:
 *     summary: Customer re-requests a fresh journey after a DRIVER_NO_SHOW cancellation. Reuses pickup/destination of the original; new journey is REQUESTED + IMMEDIATE.
 *     tags: [Journeys]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       201:
 *         description: Newly created REQUESTED journey with redispatchedFromId set.
 *       400:
 *         description: Original is not CANCELLED+DRIVER_NO_SHOW, the 30-min window is closed, or already redispatched.
 *       403:
 *         description: Caller is not the customer for the original journey.
 */
// POST /api/journeys/:id/redispatch — R3-N-4 customer re-discovery.
router.post(
  '/:id/redispatch',
  authMiddleware,
  customerOnly,
  async (req, res, next) => {
    try {
      const fresh = await journeyService.redispatchJourney(
        req.params.id,
        req.user!.userId,
      );
      emitToJourney(fresh.id, SOCKET_EVENTS.JOURNEY_CREATED, fresh);
      res.status(201).json(fresh);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * @openapi
 * /api/journeys/{id}/dispute-no-show:
 *   post:
 *     summary: Driver disputes a system- or customer-attributed DRIVER_NO_SHOW. Stamps driverDisputedAt; surfaces in admin queue under DRIVER_NO_SHOW_DISPUTE.
 *     tags: [Journeys]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Updated journey (driverDisputedAt set).
 *       400:
 *         description: Not a no-show, already disputed, or 7-day dispute window closed.
 *       403:
 *         description: Caller is not the assigned driver for this journey.
 */
// POST /api/journeys/:id/dispute-no-show — R3-N-4 driver-side dispute filing.
router.post(
  '/:id/dispute-no-show',
  authMiddleware,
  driverOnly,
  async (req, res, next) => {
    try {
      const journey = await journeyService.disputeNoShow(
        req.params.id,
        req.user!.userId,
      );
      res.json(journey);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * @openapi
 * /api/journeys/{id}/cancel-scheduled:
 *   post:
 *     summary: Customer cancels a SCHEDULED ride before the bid window opens.
 *     tags: [Journeys]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Updated journey (status CANCELLED).
 *       403:
 *         description: Caller is not the customer for this scheduled ride.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
// POST /api/journeys/:id/cancel-scheduled - cancel a SCHEDULED ride (customer only)
router.post('/:id/cancel-scheduled', authMiddleware, customerOnly, async (req, res, next) => {
  try {
    const journey = await journeyService.cancelScheduledJourney(req.params.id, req.user!.userId);
    emitToJourney(journey.id, SOCKET_EVENTS.SCHEDULED_RIDE_CANCELLED, journey);
    res.json(journey);
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/journeys/{id}/reconciliation-status:
 *   get:
 *     summary: Returns the reconciliation state for an INTERRUPTED journey — caller's own response, the other party's response (if any), and the verdict once both have answered.
 *     tags: [Journeys]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Reconciliation status payload.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ownResponse:        { type: object, nullable: true }
 *                 otherPartyResponse: { type: object, nullable: true }
 *                 verdict:            { type: string, nullable: true, enum: [BOTH_ARRIVED, CONFLICT] }
 *                 journey:            { type: object }
 */
router.get('/:id/reconciliation-status', authMiddleware, async (req, res, next) => {
  try {
    const status = await getReconciliationStatus(req.params.id, req.user!.userId);
    res.json(status);
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/journeys/{id}/reconcile:
 *   post:
 *     summary: Records a reconciliation response (ARRIVED_SAFELY / NEVER_ARRIVED / NEED_HELP) for an INTERRUPTED journey. Once both parties respond, the verdict (BOTH_ARRIVED -> COMPLETED, CONFLICT -> DISPUTED) is applied.
 *     tags: [Journeys]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [response]
 *             properties:
 *               response: { type: string, enum: [ARRIVED_SAFELY, NEVER_ARRIVED, NEED_HELP] }
 *               gpsLat:   { type: number, format: float }
 *               gpsLng:   { type: number, format: float }
 *     responses:
 *       200:
 *         description: Recording result; includes verdict if both parties have now responded.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 rowId:                { type: string, format: uuid }
 *                 bothPartiesResponded: { type: boolean }
 *                 verdict:              { type: string, nullable: true, enum: [BOTH_ARRIVED, CONFLICT] }
 *       403:
 *         description: Caller is not a participant on this journey.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post('/:id/reconcile', authMiddleware, validate(reconcileSchema), async (req, res, next) => {
  try {
    const result = await journeyService.recordReconciliationResponse({
      journeyId: req.params.id,
      respondingUserId: req.user!.userId,
      response: req.body.response,
      gpsLat: req.body.gpsLat,
      gpsLng: req.body.gpsLng,
    });
    res.json(result);
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/journeys/{id}/legs/{legId}/complete:
 *   post:
 *     summary: R3-LEGS — driver marks an intermediate leg as completed (e.g., after dropping a parcel at a multi-stop dropoff). Authorisation - caller must be the journey's assigned driver.
 *     tags: [Journeys]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: legId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Leg transitioned to COMPLETED with completedAt stamped.
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { success: { type: boolean } } }
 *       403:
 *         description: Caller is not the assigned driver for this journey.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       404:
 *         description: Leg not found for this journey.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
// POST /api/journeys/:id/legs/:legId/complete — R3-LEGS driver-side
// stop completion. The composite (legId, journeyId) where in
// markLegCompleted prevents cross-journey leg manipulation.
router.post(
  '/:id/legs/:legId/complete',
  authMiddleware,
  driverOnly,
  async (req, res, next) => {
    try {
      const { id: journeyId, legId } = req.params;
      const journey = await prisma.journey.findUnique({
        where: { id: journeyId },
        select: { driverId: true },
      });
      if (!journey) {
        res.status(404).json({
          error: { code: 'JOURNEY_NOT_FOUND', message: 'errors.journeyNotFound' },
        });
        return;
      }
      if (journey.driverId !== req.user!.userId) {
        res.status(403).json({
          error: { code: 'NOT_DRIVER', message: 'errors.notAssignedDriver' },
        });
        return;
      }
      try {
        await markLegCompleted(legId, journeyId);
      } catch {
        res.status(404).json({
          error: { code: 'LEG_NOT_FOUND', message: 'errors.legNotFound' },
        });
        return;
      }
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * @openapi
 * /api/journeys/{id}/legs/{legId}/activate:
 *   post:
 *     summary: R3-DELIVERY-NOTIFICATIONS-2 — driver flips a PENDING leg to ACTIVE (e.g., "I have arrived at this pickup"). Triggers a driver-arrived-at-pickup SMS to the customer when the leg type is GOODS_PICKUP. Authorisation - caller must be the journey's assigned driver.
 *     tags: [Journeys]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: legId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Leg transitioned to ACTIVE.
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { success: { type: boolean } } }
 *       403:
 *         description: Caller is not the assigned driver for this journey.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       404:
 *         description: Leg not found for this journey.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
// POST /api/journeys/:id/legs/:legId/activate — R3-DELIVERY-NOTIFICATIONS-2
// driver-arrived-at-pickup. Mirrors the /complete endpoint's auth +
// composite-where pattern; the markLegActive service fires the
// customer SMS when the leg type is GOODS_PICKUP.
router.post(
  '/:id/legs/:legId/activate',
  authMiddleware,
  driverOnly,
  async (req, res, next) => {
    try {
      const { id: journeyId, legId } = req.params;
      const journey = await prisma.journey.findUnique({
        where: { id: journeyId },
        select: { driverId: true },
      });
      if (!journey) {
        res.status(404).json({
          error: { code: 'JOURNEY_NOT_FOUND', message: 'errors.journeyNotFound' },
        });
        return;
      }
      if (journey.driverId !== req.user!.userId) {
        res.status(403).json({
          error: { code: 'NOT_DRIVER', message: 'errors.notAssignedDriver' },
        });
        return;
      }
      try {
        await markLegActive(legId, journeyId);
      } catch {
        res.status(404).json({
          error: { code: 'LEG_NOT_FOUND', message: 'errors.legNotFound' },
        });
        return;
      }
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
