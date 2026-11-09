import { Router } from 'express';
import multer from 'multer';
import { authMiddleware } from '../middleware/auth';
import prisma from '../prisma';
import { AppError } from '../middleware/error-handler';
import { SniffedType } from '../utils/file-type';
import {
  assertSniffedType,
  storeUploadedDocument,
} from '../services/document-upload.service';
import { deleteDocumentsForUrls } from '../services/document-deletion.service';

// DOC-GUARD G3 — the bytes are held in memory so they can be examined
// before anything is written, and encrypted before they reach disk.
// Nothing writes plaintext to the filesystem any more, so the old
// diskStorage (which named files `photo-<ts>-<rand><ext>` under
// uploads/journeys/<journeyId>/) is gone; storeUploadedDocument assigns
// an opaque uuid instead.
//
// The `fileFilter` that used to live here tested `file.mimetype` — a
// header the uploading client writes itself. It is replaced by
// assertSniffedType below, which reads the file's magic bytes. The
// accepted set is unchanged: JPEG, PNG and WebP. A PDF is still refused
// here — a pickup photograph is a photograph — while the verification
// documents in user.routes.ts do accept one.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

const JOURNEY_PHOTO_TYPES: SniffedType[] = ['image/jpeg', 'image/png', 'image/webp'];

const router = Router();

/**
 * @openapi
 * /api/journeys/{id}/upload/pickup-photo:
 *   post:
 *     summary: Upload the pickup photo for a journey (multipart, JPEG/PNG/WebP, max 10 MB).
 *     tags: [Uploads]
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
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [photo]
 *             properties:
 *               photo:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Stored URL.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 url: { type: string }
 *       403:
 *         description: Caller is not a participant of this journey.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
// POST /api/journeys/:id/upload/pickup-photo - upload pickup photo
router.post('/:id/upload/pickup-photo', authMiddleware, upload.single('photo'), async (req, res, next) => {
  try {
    if (!req.file) {
      throw new AppError(400, 'NO_FILE', 'errors.noFileUploaded');
    }

    const journey = await prisma.journey.findUnique({ where: { id: req.params.id } });
    if (!journey) {
      throw new AppError(404, 'JOURNEY_NOT_FOUND', 'errors.journeyNotFound');
    }

    // Verify user is driver or customer of this journey
    if (journey.customerId !== req.user!.userId && journey.driverId !== req.user!.userId) {
      throw new AppError(403, 'NOT_JOURNEY_PARTICIPANT', 'errors.notJourneyParticipant');
    }

    assertSniffedType(req.file.buffer, JOURNEY_PHOTO_TYPES);
    const photoUrl = storeUploadedDocument(req.file.buffer);

    await prisma.journey.update({
      where: { id: req.params.id },
      data: { pickupPhotoUrl: photoUrl },
    });

    // DOC-GUARD G2 — the superseded photo would otherwise stay on disk
    // with nothing pointing at it. See the note in user.routes.ts.
    if (journey.pickupPhotoUrl && journey.pickupPhotoUrl !== photoUrl) {
      deleteDocumentsForUrls([journey.pickupPhotoUrl]);
    }

    res.json({ url: photoUrl });
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/journeys/{id}/upload/delivery-photo:
 *   post:
 *     summary: Upload the delivery photo for a journey (multipart, JPEG/PNG/WebP, max 10 MB).
 *     tags: [Uploads]
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
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [photo]
 *             properties:
 *               photo:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Stored URL.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 url: { type: string }
 *       403:
 *         description: Caller is not a participant of this journey.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
// POST /api/journeys/:id/upload/delivery-photo - upload delivery photo
router.post('/:id/upload/delivery-photo', authMiddleware, upload.single('photo'), async (req, res, next) => {
  try {
    if (!req.file) {
      throw new AppError(400, 'NO_FILE', 'errors.noFileUploaded');
    }

    const journey = await prisma.journey.findUnique({ where: { id: req.params.id } });
    if (!journey) {
      throw new AppError(404, 'JOURNEY_NOT_FOUND', 'errors.journeyNotFound');
    }

    // Verify user is driver or customer of this journey
    if (journey.customerId !== req.user!.userId && journey.driverId !== req.user!.userId) {
      throw new AppError(403, 'NOT_JOURNEY_PARTICIPANT', 'errors.notJourneyParticipant');
    }

    assertSniffedType(req.file.buffer, JOURNEY_PHOTO_TYPES);
    const photoUrl = storeUploadedDocument(req.file.buffer);

    await prisma.journey.update({
      where: { id: req.params.id },
      data: { deliveryPhotoUrl: photoUrl },
    });

    // DOC-GUARD G2 — the superseded photo would otherwise stay on disk
    // with nothing pointing at it. See the note in user.routes.ts.
    if (journey.deliveryPhotoUrl && journey.deliveryPhotoUrl !== photoUrl) {
      deleteDocumentsForUrls([journey.deliveryPhotoUrl]);
    }

    res.json({ url: photoUrl });
  } catch (err) { next(err); }
});

export default router;
