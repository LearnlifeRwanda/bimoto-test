import { Router } from 'express';
import multer from 'multer';
import { authMiddleware, driverOnly } from '../middleware/auth';
import { rateLimit } from '../middleware/rate-limit';
import {
  openMoneyStepUp,
  closeMoneyStepUp,
} from '../middleware/money-step-up';
import * as moneyPin from '../services/money-pin.service';
import { AppError } from '../middleware/error-handler';
import * as userService from '../services/user.service';
import { SniffedType } from '../utils/file-type';
import {
  assertSniffedType,
  storeUploadedDocument,
} from '../services/document-upload.service';
import { deleteDocumentsForUrls } from '../services/document-deletion.service';
import { buildDataExport } from '../services/data-export.service';
import {
  cancelDeletion,
  requestDeletion,
} from '../services/account-deletion.service';
import prisma from '../prisma';
import { getDriverTier, getCustomerTier, getVehicleCompliance, DRIVER_TIERS, CUSTOMER_TIERS, updateMeSchema } from '@bimoto/shared';
import { validate } from '../middleware/validate';

const router = Router();

// Multer for verification document uploads.
//
// DOC-GUARD G2/G3 — the old diskStorage wrote each document to
// `uploads/verification/<userId>/<docType><ext>`. That name is a
// complete description of the file: whose it is and what it is. Since
// the directory was served by an unauthenticated static mount, and
// since the API hands `driverId` to the customer of any journey a
// motari was matched to, every licence sat at a URL that could simply
// be typed out. Documents are now written under an opaque uuid by
// storeUploadedDocument, encrypted, and read back only through the
// authenticated route.
//
// The old `fileFilter` tested `file.mimetype`, which the uploading
// client supplies. assertSniffedType reads the magic bytes instead.
// The accepted set is unchanged — JPEG, PNG and PDF: a licence often
// arrives from a scanner app as a PDF, which is why this list has one
// where the journey-photo list does not.
const verificationUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const VERIFICATION_DOC_TYPES: SniffedType[] = [
  'image/jpeg',
  'image/png',
  'application/pdf',
];

/**
 * @openapi
 * /api/users/me:
 *   get:
 *     summary: Return the authenticated user's full profile (with decrypted phone).
 *     tags: [Users]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Authenticated user.
 *         content:
 *           application/json:
 *             schema: { type: object }
 *       401:
 *         description: Not authenticated.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
// GET /api/users/me - return full user with decrypted phone
router.get('/me', authMiddleware, async (req, res, next) => {
  try {
    const user = await userService.getMe(req.user!.userId);
    res.json(user);
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/users/me:
 *   put:
 *     summary: Update mutable profile fields.
 *     tags: [Users]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               nickname:          { type: string }
 *               language:          { type: string, example: rw }
 *               emergencyContacts: { type: array, items: { type: string } }
 *               role:              { type: string, enum: [CUSTOMER, DRIVER, BOTH], description: Self-assignable roles only; ADMIN and COOPERATIVE_LEADER are rejected with 400 ROLE_NOT_SELF_ASSIGNABLE. }
 *     responses:
 *       200:
 *         description: Updated user.
 *         content:
 *           application/json:
 *             schema: { type: object }
 */
// PUT /api/users/me - update nickname, language, emergencyContacts, role
//
// VALIDATE-MEND G2 — this route carried no validate() at all, alone
// among the routes in this file, and an emergency contact went from a
// text input to encrypt() with nothing but the client's
// `!newContact.trim()` in between. updateMeSchema states the FULL
// current contract (nickname, language, emergencyContacts, role) so
// adding it tightens exactly one field and no other: `role` stays a
// bare string on purpose, because the honest answer to 'ADMIN' is the
// service's 400 ROLE_NOT_SELF_ASSIGNABLE, not a generic zod dump.
//
// The schema TRANSFORMS as well as checks: validate() reassigns
// req.body to the parsed value, so `emergencyContacts` below is already
// the normalised E.164 form the SOS path can dial.
router.put('/me', authMiddleware, validate(updateMeSchema), async (req, res, next) => {
  try {
    const { nickname, language, emergencyContacts, role } = req.body;
    const user = await userService.updateMe(req.user!.userId, {
      nickname,
      language,
      emergencyContacts,
      role,
    });
    res.json(user);
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/users/me/accept-privacy:
 *   post:
 *     summary: Record privacy-policy consent for the given version.
 *     tags: [Users]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [version]
 *             properties:
 *               version: { type: string, example: '2026-01-15' }
 *     responses:
 *       200:
 *         description: Consent recorded.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:     { type: boolean }
 *                 consentedAt: { type: string, format: date-time }
 *                 version:     { type: string }
 *       400:
 *         description: Missing or invalid version.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
// POST /api/users/me/accept-privacy
router.post('/me/accept-privacy', authMiddleware, async (req, res, next) => {
  try {
    const { version } = req.body;
    if (!version || typeof version !== 'string') {
      throw new AppError(400, 'INVALID_INPUT', 'errors.invalidInput');
    }
    const now = new Date();
    await prisma.user.update({
      where: { id: req.user!.userId },
      data: { privacyConsentAt: now, privacyConsentVersion: version },
    });
    res.json({ success: true, consentedAt: now.toISOString(), version });
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/users/me/accept-terms:
 *   post:
 *     summary: Record terms-of-service consent for the given version.
 *     tags: [Users]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [version]
 *             properties:
 *               version: { type: string }
 *     responses:
 *       200:
 *         description: Consent recorded.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:    { type: boolean }
 *                 acceptedAt: { type: string, format: date-time }
 *                 version:    { type: string }
 */
// POST /api/users/me/accept-terms
router.post('/me/accept-terms', authMiddleware, async (req, res, next) => {
  try {
    const { version } = req.body;
    if (!version || typeof version !== 'string') {
      throw new AppError(400, 'INVALID_INPUT', 'errors.invalidInput');
    }
    const now = new Date();
    await prisma.user.update({
      where: { id: req.user!.userId },
      data: { termsAcceptedAt: now, termsAcceptedVersion: version },
    });
    res.json({ success: true, acceptedAt: now.toISOString(), version });
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/users/me/accept-driver-terms:
 *   post:
 *     summary: Record driver-terms consent for the given version (driver only).
 *     tags: [Users]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [version]
 *             properties:
 *               version: { type: string }
 *     responses:
 *       200:
 *         description: Consent recorded.
 *       403:
 *         description: Caller is not a driver.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
// POST /api/users/me/accept-driver-terms
router.post('/me/accept-driver-terms', authMiddleware, driverOnly, async (req, res, next) => {
  try {
    const { version } = req.body;
    if (!version || typeof version !== 'string') {
      throw new AppError(400, 'INVALID_INPUT', 'errors.invalidInput');
    }
    const now = new Date();
    await prisma.user.update({
      where: { id: req.user!.userId },
      data: { driverTermsAcceptedAt: now, driverTermsVersion: version },
    });
    res.json({ success: true, acceptedAt: now.toISOString(), version });
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/users/me/driver-verification:
 *   put:
 *     summary: Submit or update driver verification fields. Auto-promotes to UNDER_REVIEW when complete.
 *     tags: [Users]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               drivingLicenseNumber:    { type: string }
 *               ruraAuthorizationNumber: { type: string }
 *               cooperativeName:         { type: string }
 *               insuranceConfirmed:      { type: boolean }
 *     responses:
 *       200:
 *         description: Updated driver profile.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 profile:            { type: object }
 *                 verificationStatus: { type: string, enum: [PENDING, UNDER_REVIEW, VERIFIED, REJECTED, REVOKED] }
 *       404:
 *         description: Driver profile not found.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       409:
 *         description: RURA authorization number already registered to another driver.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
// PUT /api/users/me/driver-verification
router.put('/me/driver-verification', authMiddleware, driverOnly, async (req, res, next) => {
  try {
    const { drivingLicenseNumber, ruraAuthorizationNumber, cooperativeName, insuranceConfirmed } = req.body;
    const userId = req.user!.userId;

    const driverProfile = await prisma.driverProfile.findUnique({ where: { userId } });
    if (!driverProfile) {
      throw new AppError(404, 'DRIVER_PROFILE_NOT_FOUND', 'errors.driverProfileNotFound');
    }

    const updateData: Record<string, unknown> = {};
    if (drivingLicenseNumber !== undefined) updateData.drivingLicenseNumber = drivingLicenseNumber;
    if (ruraAuthorizationNumber !== undefined) updateData.ruraAuthorizationNumber = ruraAuthorizationNumber;
    if (cooperativeName !== undefined) updateData.cooperativeName = cooperativeName;
    if (insuranceConfirmed !== undefined) updateData.insuranceConfirmed = insuranceConfirmed;

    // DRIVER-ID v3 — re-application: this submission flow is the ONLY
    // exit from REVOKED, and it re-enters at PENDING (then the normal
    // auto-promote below may lift a complete submission to
    // UNDER_REVIEW). Never straight to VERIFIED — approval still goes
    // through admin review, and assertDriverApprovable refuses REVOKED
    // profiles. revokedAt is cleared because it mirrors current state;
    // the permanent record stays in the AdminAction chain.
    if (driverProfile.verificationStatus === 'REVOKED') {
      updateData.verificationStatus = 'PENDING';
      updateData.revokedAt = null;
    }

    // DRIVER-ID v3 — ruraAuthorizationNumber is unique (the number
    // identifies exactly one person). Surface a collision as a clean
    // 409 instead of a raw Prisma P2002.
    const updated = await prisma.driverProfile
      .update({
        where: { userId },
        data: updateData,
      })
      .catch((err: any) => {
        if (err?.code === 'P2002') {
          throw new AppError(409, 'RURA_NUMBER_TAKEN', 'errors.ruraNumberTaken');
        }
        throw err;
      });

    // BIKE-GATE — completeness is vehicle-aware: the person identifier
    // (jacket number, stored in ruraAuthorizationNumber) is required for
    // every driver, while license / cooperative / insurance apply only
    // where the compliance matrix requires them. A complete submission
    // moves PENDING → UNDER_REVIEW.
    const compliance = getVehicleCompliance(driverProfile.vehicleType);
    const submissionComplete =
      Boolean(updated.ruraAuthorizationNumber) &&
      (!compliance.licenseRequired || Boolean(updated.drivingLicenseNumber)) &&
      (!compliance.cooperativeRequired || Boolean(updated.cooperativeName)) &&
      (!compliance.insuranceRequired || updated.insuranceConfirmed === true);
    if (submissionComplete && updated.verificationStatus === 'PENDING') {
      await prisma.driverProfile.update({
        where: { userId },
        data: { verificationStatus: 'UNDER_REVIEW' },
      });
      res.json({ profile: { ...updated, verificationStatus: 'UNDER_REVIEW' }, verificationStatus: 'UNDER_REVIEW' });
      return;
    }

    res.json({ profile: updated, verificationStatus: updated.verificationStatus });
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/users/me/driver-verification/upload/{docType}:
 *   post:
 *     summary: Upload a verification document (license / RURA / insurance). Multipart.
 *     tags: [Users]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: docType
 *         required: true
 *         schema:
 *           type: string
 *           enum: [driving-license, rura-authorization, insurance]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [document]
 *             properties:
 *               document:
 *                 type: string
 *                 format: binary
 *                 description: JPEG/PNG/PDF, max 10 MB.
 *     responses:
 *       200:
 *         description: Stored URL.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 url: { type: string }
 *       400:
 *         description: Invalid doc type or no file uploaded.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
// POST /api/users/me/driver-verification/upload/:docType
router.post('/me/driver-verification/upload/:docType', authMiddleware, driverOnly, verificationUpload.single('document'), async (req, res, next) => {
  try {
    const docType = req.params.docType;
    const validDocTypes = ['driving-license', 'rura-authorization', 'insurance'];
    if (!validDocTypes.includes(docType)) {
      throw new AppError(400, 'INVALID_DOC_TYPE', 'errors.invalidInput');
    }

    if (!req.file) {
      throw new AppError(400, 'NO_FILE', 'errors.noFileUploaded');
    }

    const userId = req.user!.userId;
    assertSniffedType(req.file.buffer, VERIFICATION_DOC_TYPES);
    const url = storeUploadedDocument(req.file.buffer);

    const fieldMap: Record<string, string> = {
      'driving-license': 'drivingLicensePhotoUrl',
      'rura-authorization': 'ruraAuthorizationPhotoUrl',
      'insurance': 'insurancePhotoUrl',
    };
    const field = fieldMap[docType];

    // DOC-GUARD G2 — a re-upload used to overwrite the file in place,
    // because the name was derived from the docType. Opaque keys mean
    // the replaced document would instead be left on disk with no row
    // pointing at it — unreadable through the route, and invisible to
    // the account-deletion erasure, which follows the URL columns. So
    // the superseded file is removed once its replacement is recorded.
    const previous = await prisma.driverProfile.findUnique({
      where: { userId },
      select: { [field]: true } as Record<string, boolean>,
    });

    await prisma.driverProfile.update({
      where: { userId },
      data: { [field]: url },
    });

    const previousUrl = (previous as Record<string, unknown> | null)?.[field];
    if (typeof previousUrl === 'string' && previousUrl !== url) {
      deleteDocumentsForUrls([previousUrl]);
    }

    res.json({ url });
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/users/me:
 *   delete:
 *     summary: Request account deletion. Opens a 72-hour cancellable window; the erasure itself runs later, from the execution job.
 *     description: >
 *       ACCOUNT-RIGHTS-CORE — this endpoint no longer erases anything. It
 *       records a deletion request whose `executesAt` is 72 hours out
 *       (ACCOUNT_DELETION_HOLD_HOURS). During the window the account
 *       behaves normally in every respect but one: no scheduled ride may
 *       be booked for a time past `executesAt`. Cancel with
 *       POST /api/users/me/deletion/cancel. When the clock runs out the
 *       execution job erases the account, unless a blocking state (a
 *       non-terminal journey, live escrow, an unresolved emergency, a
 *       freeze, or an unpaid driver balance) defers it to a later tick.
 *     tags: [Users]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Deletion requested; the window is open.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:    { type: boolean }
 *                 executesAt: { type: string, format: date-time, description: 'When the erasure becomes due.' }
 *       409:
 *         description: A deletion request is already pending for this account.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
// DELETE /api/users/me - request account deletion (opens the 72h window)
router.delete('/me', authMiddleware, async (req, res, next) => {
  try {
    const request = await requestDeletion(req.user!.userId);
    res.json({ success: true, executesAt: request.executesAt });
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/users/me/deletion/cancel:
 *   post:
 *     summary: Cancel a pending account-deletion request during the 72-hour window.
 *     tags: [Users]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: The pending request was cancelled; the account continues unchanged.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *       404:
 *         description: No deletion request is pending for this account.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
// POST /api/users/me/deletion/cancel - change your mind inside the window
router.post('/me/deletion/cancel', authMiddleware, async (req, res, next) => {
  try {
    await cancelDeletion(req.user!.userId);
    res.json({ success: true });
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/users/me/data-export:
 *   get:
 *     summary: Data export — every record founder decision D20 ruled the subject may have, with the fraud-prevention carve-out stated in the payload.
 *     description: >
 *       EXPORT-AND-LEDGER G1/G2. The shape grew ADDITIVELY: `profile`,
 *       `driverProfile`, `journeys`, `ratings` and `messages` are the keys
 *       this endpoint has always returned and they still carry what their
 *       names say. Two of them changed CONTENT by ruling — `messages` is now
 *       the whole conversation on every journey the caller was a party to
 *       rather than only what the caller sent, and `ratings` no longer ships
 *       the rater's id on a rating the caller RECEIVED. Everything else is
 *       new. The assembly, the per-table projections and the reason for each
 *       withheld column live in services/data-export.service.ts.
 *     tags: [Users]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: JSON download (Content-Disposition attachment).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 notice:                  { type: string, description: 'Plain-English statement of what this export deliberately withholds and how to ask for it.' }
 *                 noticeKey:               { type: string, description: 'Locale key for the same sentence, so a client can render it translated.' }
 *                 profile:                 { type: object }
 *                 driverProfile:           { type: object, nullable: true }
 *                 journeys:                { type: array, items: { type: object } }
 *                 bids:                    { type: array, items: { type: object } }
 *                 escrows:                 { type: array, items: { type: object } }
 *                 feeWaivers:              { type: array, items: { type: object } }
 *                 payoutBatches:           { type: array, items: { type: object } }
 *                 payoutPreferenceChanges: { type: array, items: { type: object } }
 *                 ratings:                 { type: array, items: { type: object } }
 *                 messages:                { type: array, items: { type: object } }
 *                 emergencyAlerts:         { type: array, items: { type: object } }
 *                 rideReports:             { type: array, items: { type: object } }
 *                 pickupVerifications:     { type: array, items: { type: object } }
 *                 reconciliationResponses: { type: array, items: { type: object } }
 *                 vehicleChangeLogs:       { type: array, items: { type: object } }
 *                 autoBidRules:            { type: array, items: { type: object } }
 *                 deletionRequests:        { type: array, items: { type: object } }
 */
// GET /api/users/me/data-export
router.get('/me/data-export', authMiddleware, async (req, res, next) => {
  try {
    const userData = await buildDataExport(req.user!.userId);

    res.setHeader('Content-Disposition', 'attachment; filename=bimoto-data-export.json');
    res.json(userData);
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/users/me/driver-profile:
 *   post:
 *     summary: Create a driver profile. A CUSTOMER account gains the ability to drive (role becomes BOTH); DRIVER and BOTH keep the role their owner chose.
 *     tags: [Users]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [vehicleType]
 *             properties:
 *               vehicleType:        { type: string, enum: [BIKE, MOTO, E_MOTO, E_BIKE] }
 *               registrationPlate:  { type: string, description: Required at approval only for vehicle types whose compliance entry has registrationRequired. }
 *               vehicleDescription: { type: string }
 *     responses:
 *       201:
 *         description: Driver profile created.
 *         content:
 *           application/json:
 *             schema: { type: object }
 */
// POST /api/users/me/driver-profile - create driver profile (role is only
// widened when the account cannot drive yet; see user.service.ts)
router.post('/me/driver-profile', authMiddleware, async (req, res, next) => {
  try {
    const { vehicleType, registrationPlate, vehicleDescription } = req.body;
    const profile = await userService.createDriverProfile(req.user!.userId, {
      vehicleType,
      registrationPlate,
      vehicleDescription,
    });
    res.status(201).json(profile);
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/users/me/driver-profile:
 *   put:
 *     summary: Self-service vehicle update (type/plate/description). Instant — no approval step; every actual change is recorded in the vehicle-change ledger.
 *     description: Deferred with 409 VEHICLE_CHANGE_BLOCKED while the driver has an active journey (MATCHED/IN_PROGRESS/AWAITING_CONFIRMATION) or an open bid (PENDING/ACCEPTED). §0.5 note&#58; the client's Settings page has always called PUT here — this handler closes the previously missing server side of that call.
 *     tags: [Users]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [vehicleType, vehicleDescription]
 *             properties:
 *               vehicleType:        { type: string, enum: [BIKE, MOTO, EMOTO] }
 *               registrationPlate:  { type: string, nullable: true }
 *               vehicleDescription: { type: string }
 *     responses:
 *       200:
 *         description: Updated driver profile.
 *         content:
 *           application/json:
 *             schema: { type: object }
 *       404:
 *         description: Driver profile not found.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       409:
 *         description: Blocked while a journey or bid is active — finish the current ride first.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
// PUT /api/users/me/driver-profile - self-service vehicle update (DRIVER-ID v3 G4)
router.put('/me/driver-profile', authMiddleware, async (req, res, next) => {
  try {
    const { vehicleType, registrationPlate, vehicleDescription } = req.body;
    if (typeof vehicleType !== 'string' || typeof vehicleDescription !== 'string') {
      throw new AppError(400, 'INVALID_INPUT', 'errors.invalidInput');
    }
    const profile = await userService.updateDriverVehicle(req.user!.userId, {
      vehicleType,
      registrationPlate,
      vehicleDescription,
    });
    res.json(profile);
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/users/me/location:
 *   put:
 *     summary: Update the authenticated driver's current GPS location.
 *     tags: [Users]
 *     security:
 *       - cookieAuth: []
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
 *         description: Updated driver profile.
 *         content:
 *           application/json:
 *             schema: { type: object }
 */
// PUT /api/users/me/location - update driver lat/lng (driver only)
router.put('/me/location', authMiddleware, driverOnly, async (req, res, next) => {
  try {
    const { lat, lng } = req.body;
    const profile = await userService.updateDriverLocation(req.user!.userId, lat, lng);
    res.json(profile);
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/users/me/online-status:
 *   put:
 *     summary: Toggle driver online/offline status (driver only).
 *     tags: [Users]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [isOnline]
 *             properties:
 *               isOnline: { type: boolean }
 *     responses:
 *       200:
 *         description: Updated driver profile.
 *         content:
 *           application/json:
 *             schema: { type: object }
 *       400:
 *         description: isOnline is not a boolean.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
// PUT /api/users/me/online-status - toggle driver online/offline status
router.put('/me/online-status', authMiddleware, driverOnly, async (req, res, next) => {
  try {
    const { isOnline } = req.body;
    if (typeof isOnline !== 'boolean') {
      res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'errors.invalidInput' } });
      return;
    }
    // DRIVER-ID v3 — a REVOKED driver cannot come online (revocation
    // forces isOnline false; this closes the toggle-back-on gap found
    // in the enum-consumer sweep).
    if (isOnline) {
      const existing = await prisma.driverProfile.findUnique({
        where: { userId: req.user!.userId },
        select: { verificationStatus: true },
      });
      if (existing?.verificationStatus === 'REVOKED') {
        throw new AppError(403, 'DRIVER_REVOKED', 'errors.driverRevoked');
      }
    }
    const profile = await prisma.driverProfile.update({
      where: { userId: req.user!.userId },
      data: { isOnline },
    });
    res.json(profile);
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/users/me/tier-status:
 *   get:
 *     summary: Return tier progress (commission rate, rides until next tier) for the user.
 *     tags: [Users]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Tier status keyed by role.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 role:         { type: string, enum: [CUSTOMER, DRIVER, BOTH] }
 *                 customerTier: { type: object, nullable: true }
 *                 driverTier:   { type: object, nullable: true }
 *       404:
 *         description: User not found.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
// GET /api/users/me/tier-status - return tier progress for user
router.get('/me/tier-status', authMiddleware, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      include: { driverProfile: true },
    });
    if (!user) {
      throw new AppError(404, 'USER_NOT_FOUND', 'errors.userNotFound');
    }

    const role = user.role as string;
    const result: Record<string, unknown> = { role };

    // Customer tier info (all users can be customers)
    if (role === 'CUSTOMER' || role === 'BOTH') {
      const customerTier = getCustomerTier(user.completedRides);
      const sortedCustomerTiers = [...CUSTOMER_TIERS].sort((a, b) => a.minRides - b.minRides);
      const currentIdx = sortedCustomerTiers.findIndex(t => t.tier === customerTier.tier);
      const nextTierInfo = currentIdx < sortedCustomerTiers.length - 1 ? sortedCustomerTiers[currentIdx + 1] : null;

      result.customerTier = {
        currentTier: customerTier.tier,
        commissionRate: customerTier.commissionRate,
        completedRides: user.completedRides,
        nextTier: nextTierInfo?.tier ?? null,
        ridesUntilNextTier: nextTierInfo ? nextTierInfo.minRides - user.completedRides : 0,
        nextTierRate: nextTierInfo?.commissionRate ?? null,
        savingsPerRideVsNew: `${((CUSTOMER_TIERS[0].commissionRate - customerTier.commissionRate) * 100).toFixed(1)}% less than new users`,
      };
    }

    // Driver tier info
    if ((role === 'DRIVER' || role === 'BOTH') && user.driverProfile) {
      const driverTier = getDriverTier(user.driverProfile.totalRides);
      const sortedDriverTiers = [...DRIVER_TIERS].sort((a, b) => a.minRides - b.minRides);
      const currentIdx = sortedDriverTiers.findIndex(t => t.tier === driverTier.tier);
      const nextTierInfo = currentIdx < sortedDriverTiers.length - 1 ? sortedDriverTiers[currentIdx + 1] : null;

      result.driverTier = {
        currentTier: driverTier.tier,
        commissionRate: driverTier.commissionRate,
        totalRides: user.driverProfile.totalRides,
        nextTier: nextTierInfo?.tier ?? null,
        ridesUntilNextTier: nextTierInfo ? nextTierInfo.minRides - user.driverProfile.totalRides : 0,
        nextTierRate: nextTierInfo?.commissionRate ?? null,
        savingsPerRideVsNew: `${((DRIVER_TIERS[0].commissionRate - driverTier.commissionRate) * 100).toFixed(1)}% less than new drivers`,
      };
    }

    res.json(result);
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/users/me/account-status:
 *   get:
 *     summary: Driver-only account status snapshot — counters, thresholds, recent disputes (R3-N-5).
 *     tags: [Users]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Account status snapshot.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:          { type: string, enum: [ACTIVE, SUSPENDED, FLAGGED] }
 *                 suspendedUntil:  { type: string, format: date-time, nullable: true }
 *                 isFlagged:       { type: boolean }
 *                 counters:        { type: object }
 *                 thresholds:      { type: object }
 *                 recentDisputes:  { type: array, items: { type: object } }
 *       403:
 *         description: Caller is not a driver.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       404:
 *         description: User not found.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
// GET /api/users/me/account-status — driver account status snapshot (R3-N-5)
router.get('/me/account-status', authMiddleware, driverOnly, async (req, res, next) => {
  try {
    const status = await userService.getDriverAccountStatus(req.user!.userId);
    res.json(status);
  } catch (err) { next(err); }
});


// ── MONEY-PIN (founder ruling D25) ─────────────────────────────────────
//
// Five endpoints, all driver-only, none of which ever return, log or
// echo a PIN. The PIN travels in exactly one direction — up, in a request
// body, over TLS — and the response says only whether it worked.
//
// A NOTE ON WHY THESE ARE NOT BEHIND requireMoneyStepUp. They are the
// gate's own doors: verifying is how a session is opened, enrolling is
// what an ungated driver is sent here to do, and the reset exists for
// the driver who cannot pass the gate at all. Putting the gate in front
// of them would lock every one of them behind itself.

// Six PIN attempts a minute per IP. The real bound on guessing is the
// per-user attempt budget in money-pin.service (which terminates); this
// only stops a caller burning server time trying.
const moneyPinRateLimit = rateLimit(6, 60_000, 'money-pin');

/**
 * @openapi
 * /api/users/me/money-pin:
 *   get:
 *     summary: Whether this driver has a money PIN, and whether a delayed reset is pending.
 *     tags: [Users]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: PIN status. Never includes the PIN or its hash.
 */
router.get('/me/money-pin', authMiddleware, driverOnly, async (req, res, next) => {
  try {
    const status = await moneyPin.getMoneyPinStatus(req.user!.userId);
    res.json({
      state: status.state,
      pendingActivatesAt: status.pendingActivatesAt?.toISOString() ?? null,
      lockedUntil: status.lockedUntil?.toISOString() ?? null,
    });
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/users/me/money-pin:
 *   post:
 *     summary: Set a money PIN for the first time. Refuses if one already exists.
 *     tags: [Users]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [pin]
 *             properties:
 *               pin: { type: string, description: "4 digits" }
 *     responses:
 *       200:
 *         description: PIN set. A step-up session is opened, so the money surface the driver was blocked on completes without a second prompt.
 *       409:
 *         description: A PIN already exists — use the change endpoint.
 */
router.post('/me/money-pin', authMiddleware, driverOnly, moneyPinRateLimit, async (req, res, next) => {
  try {
    const { pin } = req.body ?? {};
    await moneyPin.setMoneyPin(req.user!.userId, pin);
    // Enrolment opens the session. The driver has just proven the PIN by
    // choosing it; asking him to type it again on the very next screen
    // would be friction that proves nothing.
    openMoneyStepUp(req.user!.userId);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/users/me/money-pin/verify:
 *   post:
 *     summary: Prove the money PIN and open a short-lived step-up session.
 *     tags: [Users]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [pin]
 *             properties:
 *               pin: { type: string }
 *     responses:
 *       200:
 *         description: Verified. The session lives SERVER-SIDE; the response carries no token.
 *       401:
 *         description: Wrong PIN. One guess spent.
 *       423:
 *         description: Attempt budget exhausted.
 */
router.post('/me/money-pin/verify', authMiddleware, driverOnly, moneyPinRateLimit, async (req, res, next) => {
  try {
    const { pin } = req.body ?? {};
    const result = await moneyPin.verifyMoneyPin(req.user!.userId, pin);
    openMoneyStepUp(req.user!.userId);
    res.json({
      ok: true,
      // So the client can say "your new PIN is now active" / "the pending
      // change was cancelled" in words, rather than the driver noticing
      // silently. Neither field carries a PIN.
      activatedPendingReset: result.activatedPendingReset,
      cancelledPendingReset: result.cancelledPendingReset,
    });
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/users/me/money-pin/change:
 *   post:
 *     summary: Change the money PIN using the current one. Immediate — no delay.
 *     tags: [Users]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [currentPin, newPin]
 *             properties:
 *               currentPin: { type: string }
 *               newPin:     { type: string }
 *     responses:
 *       200:
 *         description: Changed.
 */
router.post('/me/money-pin/change', authMiddleware, driverOnly, moneyPinRateLimit, async (req, res, next) => {
  try {
    const { currentPin, newPin } = req.body ?? {};
    await moneyPin.changeMoneyPin(req.user!.userId, currentPin, newPin);
    // The old session was proven by a PIN that no longer exists. Drop it
    // and open a fresh one: the driver just proved the new PIN by
    // setting it, so he is not asked again, but nothing carries over.
    closeMoneyStepUp(req.user!.userId);
    openMoneyStepUp(req.user!.userId);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/users/me/money-pin/reset/request:
 *   post:
 *     summary: Start a money-PIN reset by sending an SMS code.
 *     tags: [Users]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Code sent. The response is identical whether or not a PIN exists.
 */
router.post('/me/money-pin/reset/request', authMiddleware, driverOnly, moneyPinRateLimit, async (req, res, next) => {
  try {
    const result = await moneyPin.requestMoneyPinReset(req.user!.userId);
    res.json({ otpId: result.otpId, expiresAt: result.expiresAt.toISOString() });
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/users/me/money-pin/reset/confirm:
 *   post:
 *     summary: Complete a money-PIN reset. The new PIN goes live 24 hours later.
 *     tags: [Users]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [otpId, code, newPin]
 *             properties:
 *               otpId:  { type: string }
 *               code:   { type: string }
 *               newPin: { type: string }
 *     responses:
 *       200:
 *         description: Reset accepted. `activatesAt` is when the new PIN starts working; an SMS naming that deadline has already been sent.
 */
router.post('/me/money-pin/reset/confirm', authMiddleware, driverOnly, moneyPinRateLimit, async (req, res, next) => {
  try {
    const { otpId, code, newPin } = req.body ?? {};
    if (!otpId || !code) {
      res.status(400).json({ error: { code: 'OTP_REQUIRED', message: 'errors.otpRequired' } });
      return;
    }
    const result = await moneyPin.confirmMoneyPinReset(req.user!.userId, otpId, code, newPin);
    // NO session is opened here, and that is the whole ruling. A reset
    // proven only by SMS must not reach the money now — it reaches it in
    // 24 hours, or not at all if the owner cancels with the live PIN.
    res.json({ activatesAt: result.activatesAt.toISOString() });
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/users/{id}/profile:
 *   get:
 *     summary: Return another user's public profile (rating, completed rides, vehicle).
 *     tags: [Users]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Public profile.
 *         content:
 *           application/json:
 *             schema: { type: object }
 */
// GET /api/users/:id/profile - return public profile
router.get('/:id/profile', authMiddleware, async (req, res, next) => {
  try {
    const profile = await userService.getPublicProfile(req.params.id);
    res.json(profile);
  } catch (err) { next(err); }
});

export default router;
