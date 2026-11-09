// ACCOUNT-RIGHTS-CORE G2 — asking to be deleted, changing your mind, and
// the one atomic write that actually erases.
//
// This module replaces the immediate-and-unconditional erasure that lived
// inline in `DELETE /api/users/me`. Three things were wrong with it, and
// each is fixed here:
//
//   1. It erased instantly. A user mid-ride, or with money still held in
//      escrow, was anonymised on the spot. Founder ruling D1 (20 Aug)
//      gives them a 72-hour cancellable window instead, during which the
//      app behaves NORMALLY — see the carve-out in journey.service for
//      the single exception.
//   2. It left every session alive. The handler never revoked a refresh
//      token, and `isDeleted` was read by nothing anywhere in the repo
//      (auth checks only `frozenAt`), so a deleted account with a live
//      token kept using the app as "Deleted User". Step 7 below and the
//      auth change in G3 close that from both ends.
//   3. It was three sequential writes plus filesystem deletes. A crash
//      between them left a half-erased account with no retry path,
//      because the caller could no longer authenticate to re-run it.
//      That is the class-(a) defect txn-guard's allowlist parked under
//      this wave's name. Everything that must be all-or-nothing is now
//      one `$transaction`.
//
// What did NOT change, and must not: the erasure still hard-deletes no
// User row. Twenty-nine relation fields hang off that row — journeys,
// escrows, ratings, admin actions, AML flags — and the ID-preserving
// anonymisation is the whole architecture. Financial, audit and safety
// records are never touched. Parcel photos (`pickupPhotoUrl`,
// `deliveryPhotoUrl`) are never touched by an individual deletion
// (founder, 19 Aug); they belong to the journey, not to the account.

import type { Prisma, PrismaClient } from '@prisma/client';
import { ACCOUNT_DELETION_HOLD_HOURS, type DeferralReason } from '@bimoto/shared';
import prisma from '../prisma';
import { AppError } from '../middleware/error-handler';
import { encrypt, hashPhone } from '../utils/crypto';
import {
  deleteDocumentsForUrls,
  deleteLegacyVerificationDir,
} from './document-deletion.service';
import { invalidateAuthStatusCache } from '../middleware/auth-status-cache';
import { revokeAllRefreshTokensForUser } from './refresh-token.service';

const HOLD_MS = ACCOUNT_DELETION_HOLD_HOURS * 60 * 60 * 1000;

/** Postgres unique-violation, raised by the one-PENDING-per-user index. */
const UNIQUE_VIOLATION = 'P2002';

export interface PendingDeletionView {
  requestedAt: Date;
  executesAt: Date;
  /**
   * ACCOUNT-RIGHTS-SURFACE G1 — why the execution job passed this row over
   * on its last due attempt, or null when nothing is in the way.
   *
   * The column already existed and was already written (the job, #195);
   * what did not exist was any way for the person waiting to LEARN it. A
   * deletion that is due and has not happened reads, without this, as the
   * app ignoring them. Founder recommendation D21: they are told why, in
   * words naming what ends the wait.
   *
   * Typed as the job's own exported union rather than `string` so the
   * client's reason-to-wording map can be checked exhaustively at compile
   * time: a sixth reason must fail the build, not render a raw code.
   */
  deferredReason: DeferralReason | null;
}

/**
 * The user's live deletion request, or null. Read by `GET /api/users/me`
 * (so the client can show the window and offer the cancel) and by the
 * scheduled-ride carve-out.
 */
export async function getPendingDeletion(
  userId: string,
  client: Pick<PrismaClient, 'deletionRequest'> = prisma,
): Promise<PendingDeletionView | null> {
  const row = await client.deletionRequest.findFirst({
    where: { userId, status: 'PENDING' },
    select: { requestedAt: true, executesAt: true, deferredReason: true },
    orderBy: { requestedAt: 'desc' },
  });
  if (!row) return null;
  // The column is a plain `String?` in the schema; the job is its only
  // writer and writes only union members. Narrowed here, once, so every
  // reader downstream gets the union instead of repeating the cast.
  return { ...row, deferredReason: (row.deferredReason as DeferralReason | null) ?? null };
}

/**
 * Open the 72-hour window. Idempotent in the way that matters: a second
 * ask while one is already pending is a 409, not a second row and not a
 * silently-extended deadline. The partial unique index is what makes that
 * true under a double-tap; this read is what makes the refusal a clean
 * error instead of a database exception surfacing as a 500.
 */
export async function requestDeletion(userId: string) {
  const existing = await prisma.deletionRequest.findFirst({
    where: { userId, status: 'PENDING' },
  });
  if (existing) {
    throw new AppError(409, 'DELETION_ALREADY_PENDING', 'errors.deletionAlreadyPending');
  }

  const requestedAt = new Date();
  const executesAt = new Date(requestedAt.getTime() + HOLD_MS);

  try {
    return await prisma.deletionRequest.create({
      data: { userId, status: 'PENDING', requestedAt, executesAt },
    });
  } catch (err) {
    // Two taps raced past the read above. The index refused the second
    // one, which is the invariant working — report it as the same 409 the
    // loser would have got a millisecond earlier.
    if ((err as { code?: string })?.code === UNIQUE_VIOLATION) {
      throw new AppError(409, 'DELETION_ALREADY_PENDING', 'errors.deletionAlreadyPending');
    }
    throw err;
  }
}

/**
 * Change your mind. Only a PENDING row can be cancelled; an already-
 * executed erasure has no undo, and an already-cancelled one is not
 * pending. Both answer 404 rather than pretending to succeed.
 */
export async function cancelDeletion(userId: string) {
  const updated = await prisma.deletionRequest.updateMany({
    where: { userId, status: 'PENDING' },
    data: { status: 'CANCELLED', cancelledAt: new Date(), deferredReason: null },
  });
  if (updated.count === 0) {
    throw new AppError(404, 'NO_DELETION_PENDING', 'errors.noDeletionPending');
  }
  return { cancelled: updated.count };
}

export interface ErasureResult {
  /** Document URLs the post-commit sweep was asked to remove. */
  documentUrls: Array<string | null | undefined>;
  /** Live sessions killed by step 7. */
  revokedTokenCount: number;
  /** The tombstone's deletion count after this erasure. */
  deletionCount: number;
}

/**
 * THE ERASURE. One transaction, in this order, and the order matters.
 *
 * The tombstone (step 2) must be written from the ORIGINAL phoneHash read
 * in step 1, in the same transaction as step 3 — which is the write that
 * destroys that hash on the User row. Split them and there is a window in
 * which the returner key exists nowhere, or worse, a crash leaves the
 * account erased with no tombstone at all: a suspended user could then
 * re-register clean, which is exactly the reactivation-by-deletion the
 * founder ruled out.
 *
 * The filesystem work and the cache invalidation happen AFTER commit,
 * because neither can be rolled back and neither may be done for an
 * erasure that did not commit. Same discipline as freeze.service.
 */
export async function executeErasure(userId: string): Promise<ErasureResult> {
  let documentUrls: Array<string | null | undefined> = [];

  const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // 1. Everything the later steps need, read before anything overwrites
    //    it. The driver photo URLs in particular: step 4 nulls the
    //    columns, so a read after it has nothing left to follow.
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        phoneHash: true,
        suspendedUntil: true,
        frozenAt: true,
      },
    });
    if (!user) {
      throw new AppError(404, 'USER_NOT_FOUND', 'errors.userNotFound');
    }
    const originalPhoneHash = user.phoneHash;

    // DOC-GUARD G2 — read the document URLs BEFORE the anonymisation
    // nulls them, otherwise the post-commit sweep has nothing to follow.
    const profileBeforeErasure = await tx.driverProfile.findUnique({
      where: { userId },
      select: {
        drivingLicensePhotoUrl: true,
        ruraAuthorizationPhotoUrl: true,
        insurancePhotoUrl: true,
      },
    });

    const now = new Date();

    // 2. The lawful tombstone — founder ruling D2's three facts, keyed by
    //    the hash the next line destroys.
    //
    //    `wasSuspended` is sticky-OR: the update branch sets it true only
    //    when this erasure found a blocking state, and never sets it back
    //    to false. A user who was suspended, deleted, came back and
    //    deleted again cleanly keeps the flag — otherwise the second
    //    cycle would launder the first.
    const wasSuspendedNow =
      (user.suspendedUntil !== null && user.suspendedUntil > now) ||
      user.frozenAt !== null;

    const tombstone = await tx.accountTombstone.upsert({
      where: { phoneHash: originalPhoneHash },
      create: {
        phoneHash: originalPhoneHash,
        deletionCount: 1,
        wasSuspended: wasSuspendedNow,
        lastDeletedAt: now,
      },
      update: {
        deletionCount: { increment: 1 },
        lastDeletedAt: now,
        ...(wasSuspendedNow ? { wasSuspended: true } : {}),
      },
    });

    // 3. The User anonymisation, unchanged from the pre-window handler.
    //    The row survives; only the person in it is removed.
    await tx.user.update({
      where: { id: userId },
      data: {
        phoneEncrypted: encrypt('DELETED-' + userId),
        phoneHash: hashPhone('DELETED-' + userId),
        nickname: 'Deleted User',
        emergencyContactsEncrypted: null,
        isDeleted: true,
        accountDeletedAt: now,
      },
    });

    // 4. The DriverProfile anonymisation, unchanged.
    //
    //    DRIVER-ID v3 G4: this write deliberately bypasses the
    //    vehicle-change guard and ledger (updateDriverVehicle) — it is an
    //    erasure, not a switch.
    await tx.driverProfile.updateMany({
      where: { userId },
      data: {
        registrationPlate: null,
        vehicleDescription: 'Deleted',
        drivingLicenseNumber: null,
        ruraAuthorizationNumber: null,
        cooperativeName: null,
        drivingLicensePhotoUrl: null,
        ruraAuthorizationPhotoUrl: null,
        insurancePhotoUrl: null,
        isOnline: false,
      },
    });

    // 5. Push targets. DeviceToken declares `onDelete: Cascade`, which
    //    never fires because we never hard-delete the User row — so the
    //    rows have to go explicitly, or an erased account keeps receiving
    //    push notifications on every device it ever registered.
    await tx.deviceToken.deleteMany({ where: { userId } });

    // 6. Outstanding login codes for the ORIGINAL number. Keyed by
    //    phoneHash, not userId: an OTP requested before the account
    //    existed carries a null userId, and it is the number that must
    //    stop being loggable-into.
    await tx.otpCode.deleteMany({ where: { phoneHash: originalPhoneHash } });

    // 7. Every live session. This is the step the old handler simply did
    //    not have. Composed through the tx-joinable variant rather than
    //    a second copy of the query — the *Tx composition precedent from
    //    escrow.service (#184).
    const revokedTokenCount = await revokeAllRefreshTokensForUser(userId, tx);

    // 8. Close the request that authorised all of this.
    await tx.deletionRequest.updateMany({
      where: { userId, status: 'PENDING' },
      data: { status: 'EXECUTED', executedAt: now, deferredReason: null },
    });

    documentUrls = [
      profileBeforeErasure?.drivingLicensePhotoUrl,
      profileBeforeErasure?.ruraAuthorizationPhotoUrl,
      profileBeforeErasure?.insurancePhotoUrl,
    ];

    return {
      revokedTokenCount,
      deletionCount: tombstone.deletionCount,
    };
  });

  // ---- after commit only ----------------------------------------------
  //
  // Nothing below can be rolled back, so nothing below may run for an
  // erasure that did not commit. Each is best-effort and independently
  // failable: a filesystem hiccup must not un-erase an account.

  // DOC-GUARD G2 — follow the URL columns, which is where a document's
  // location actually lives now. The directory sweep stays for files
  // written before that change.
  try {
    deleteDocumentsForUrls(documentUrls);
    deleteLegacyVerificationDir(userId);
  } catch (err) {
    console.warn('[ACCOUNT-DELETION] document-sweep-fail', userId, err);
  }

  // The auth layer caches {frozenAt, isDeleted} per user (G3). Without
  // this, an erased account would keep passing auth until the TTL lapsed.
  // Same contract freeze.service honours.
  invalidateAuthStatusCache(userId);

  return { ...result, documentUrls };
}
