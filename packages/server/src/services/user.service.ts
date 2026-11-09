import { VehicleType } from '@prisma/client';
import prisma from '../prisma';
import { encrypt, hashPhone } from '../utils/crypto';
import {
  decryptedPhone,
  parseEmergencyContacts,
} from './user-phone';
// CUTGUARD v2 G1 — the positive allowlist every user payload passes
// through. See services/client-user.ts for why a negative list could
// not hold.
import {
  CLIENT_USER_INCLUDE,
  toClientUser,
  type ClientUser,
} from './client-user';
import { AppError } from '../middleware/error-handler';
import { PENALTY_THRESHOLDS } from './driver-penalty';
import { getPendingDeletion } from './account-deletion.service';

// Narrowing guard so route-level strings reach Prisma as the enum type
// without a cast.
function isVehicleType(value: string): value is VehicleType {
  return (Object.values(VehicleType) as string[]).includes(value);
}

// FIELD-FIT G3 — the roles a person may put on their own account.
//
// The team's only siren-flagged report was "when you created an account
// as a driver and after some time the app changes your account to both
// (DRIVER,USER)". Two writes could change a role, and neither asked the
// account's owner:
//
//   1. createDriverProfile wrote role:'BOTH' unconditionally, so
//      choosing "Motari" on the register screen was overwritten one
//      request later by the driver-profile POST that follows it;
//   2. updateMe passed req.body.role straight through, so ADMIN and
//      COOPERATIVE_LEADER were self-assignable by anyone with a session.
//
// Whether BOTH accounts should exist at all is a separate, open
// question (Trello item 2) and is deliberately untouched: BOTH stays a
// choice a person can make. What changes is that only the person's own
// choice decides, and every actual change is logged.
export const SELF_ASSIGNABLE_ROLES = ['CUSTOMER', 'DRIVER', 'BOTH'] as const;
export type SelfAssignableRole = (typeof SELF_ASSIGNABLE_ROLES)[number];

export function isSelfAssignableRole(value: unknown): value is SelfAssignableRole {
  return (SELF_ASSIGNABLE_ROLES as readonly unknown[]).includes(value);
}

/** One line per real role change, so the field can be audited from logs. */
function logRoleChange(userId: string, from: string, to: string, cause: string): void {
  console.log(`[ROLE] ${userId} ${from} -> ${to} (${cause})`);
}

// DECRYPT v3 — the implementation moved to services/user-phone.ts, which
// is now the only module that decrypts a phone-shaped column. Re-exported
// here so existing importers keep working unchanged.
export { parseEmergencyContacts } from './user-phone';

export async function getMe(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: CLIENT_USER_INCLUDE,
  });

  if (!user) {
    throw new AppError(404, 'USER_NOT_FOUND', 'errors.userNotFound');
  }

  // CUTGUARD v2 G1 — was `const { phoneEncrypted, emergencyContactsEncrypted,
  // ...rest } = user`, a NEGATIVE list. It named the two ciphertext
  // columns and shipped everything else, so `moneyPinHash` (unsalted),
  // `moneyPinPendingHash`, the attempt counters, `phoneHash`,
  // `disputeRate`, `isFlagged`, `flagReason` and the four `frozen*`
  // columns each joined this payload on the day they were declared,
  // without a diff anywhere saying so. `toClientUser` is the positive
  // list: a column reaches a client only by being written down.
  const clientUser = toClientUser(user);

  // ACCOUNT-RIGHTS-CORE G2 — additive: `null` for every account that has
  // not asked to be deleted, which is every account that existed before
  // this field did. The client needs both timestamps to say "you asked on
  // Tuesday, we erase on Friday" and to offer the cancel; AR-SURFACE
  // renders it (components/ui/DeletionBanner.tsx).
  //
  // ACCOUNT-RIGHTS-SURFACE G1 — the view now carries `deferredReason` too.
  // Same read, one more column: a deletion whose 72 hours have run out and
  // which the job keeps passing over needs to be able to SAY so, or the
  // banner counts down to zero and then sits there looking broken.
  const accountDeletion = await getPendingDeletion(userId);

  return {
    ...clientUser,
    accountDeletion,
  };
}

export async function updateMe(
  userId: string,
  data: {
    nickname?: string;
    language?: string;
    // VALIDATE-MEND G2 — was declared `string`. The client has always
    // sent an ARRAY, and JSON.stringify swallowed the difference at
    // runtime, so nothing failed and no compiler ever looked at the
    // shape. That is why a list of non-numbers could be encrypted
    // without a word. The route now parses updateMeSchema before this
    // is called, so every entry arriving here is already a normalised
    // E.164 string.
    emergencyContacts?: string[];
    role?: string;
  },
) {
  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user) {
    throw new AppError(404, 'USER_NOT_FOUND', 'errors.userNotFound');
  }

  const updateData: Record<string, unknown> = {};
  if (data.nickname !== undefined) updateData.nickname = data.nickname;
  if (data.language !== undefined) updateData.language = data.language;
  if (data.emergencyContacts !== undefined) {
    // Validation is a WRITE-time rule and only a write-time rule. Rows
    // stored before updateMeSchema existed keep whatever they hold and
    // are read back through parseEmergencyContacts unchanged — there is
    // no migration and nothing re-validates stored data. Deleting a
    // person's emergency contact because it fails a rule written after
    // they typed it would be a worse outcome than showing it to them.
    updateData.emergencyContactsEncrypted = encrypt(JSON.stringify(data.emergencyContacts));
  }
  // FIELD-FIT G3 — a person may set their own role, but only to one of
  // the three they are offered on the register screen. ADMIN and
  // COOPERATIVE_LEADER are granted by an operator, never claimed: before
  // this check any authenticated caller could PUT {"role":"ADMIN"} and
  // then read the admin surfaces, including driver identity documents.
  if (data.role !== undefined) {
    if (!isSelfAssignableRole(data.role)) {
      throw new AppError(400, 'ROLE_NOT_SELF_ASSIGNABLE', 'errors.roleNotSelfAssignable');
    }
    if (data.role !== user.role) {
      logRoleChange(userId, user.role, data.role, 'user set their own role');
      updateData.role = data.role;
    }
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: updateData,
    include: CLIENT_USER_INCLUDE,
  });

  // CUTGUARD v2 G1 — same negative-list defect as getMe, same fix. The
  // client renders THIS response after a profile save, so it carried the
  // identical column set.
  return toClientUser(updated);
}

export async function createDriverProfile(
  userId: string,
  data: {
    vehicleType: string;
    registrationPlate?: string;
    vehicleDescription: string;
  },
) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { driverProfile: true },
  });

  if (!user) {
    throw new AppError(404, 'USER_NOT_FOUND', 'errors.userNotFound');
  }

  if (user.driverProfile) {
    throw new AppError(409, 'DRIVER_PROFILE_EXISTS', 'errors.driverProfileExists');
  }

  if (!isVehicleType(data.vehicleType)) {
    throw new AppError(400, 'INVALID_VEHICLE_TYPE', 'errors.invalidInput');
  }

  // FIELD-FIT G3 — this used to write role:'BOTH' unconditionally, which
  // is the reported flip: RegisterPage PUTs the chosen role and then
  // POSTs here, so a person who chose "Motari" was silently widened to
  // BOTH one request later. The client kept showing DRIVER (it renders
  // the PUT response) and the next login read BOTH from the database —
  // "after some time the app changes your account".
  //
  // A driver profile now only ever *adds* the ability to drive to an
  // account that lacks it. A CUSTOMER who creates one has explicitly
  // asked to drive, and keeps their passenger side (BOTH). DRIVER and
  // BOTH already carry it, so their role is left exactly as its owner
  // set it. ADMIN / COOPERATIVE_LEADER are never rewritten from here.
  const needsDriverRole = user.role === 'CUSTOMER';

  const [driverProfile] = await prisma.$transaction([
    prisma.driverProfile.create({
      data: {
        userId,
        vehicleType: data.vehicleType,
        registrationPlate: data.registrationPlate ?? null,
        vehicleDescription: data.vehicleDescription,
      },
    }),
    ...(needsDriverRole
      ? [prisma.user.update({ where: { id: userId }, data: { role: 'BOTH' } })]
      : []),
  ]);

  if (needsDriverRole) {
    logRoleChange(userId, user.role, 'BOTH', 'customer added a driver profile');
  }

  return driverProfile;
}

// DRIVER-ID v3 G4 — vehicle-change honesty. The person is the identity;
// the motorcycle is a mutable attribute (most Kigali motari rent their
// machine), so switching stays self-service and instant — no approval
// step — but becomes visible: every actual change writes an old->new
// VehicleChangeLog row, and the customer-facing payloads expose a
// neutral "updated recently" flag. The ledger is deliberately shaped
// for later fraud-pattern use (rapid serial changes), but no detector
// consumes it in this dispatch.
export const VEHICLE_UPDATED_RECENTLY_WINDOW_DAYS = 7;

export async function updateDriverVehicle(
  userId: string,
  data: {
    vehicleType: string;
    registrationPlate?: string | null;
    vehicleDescription: string;
  },
) {
  if (!isVehicleType(data.vehicleType)) {
    throw new AppError(400, 'INVALID_VEHICLE_TYPE', 'errors.invalidInput');
  }

  const profile = await prisma.driverProfile.findUnique({ where: { userId } });
  if (!profile) {
    throw new AppError(404, 'DRIVER_PROFILE_NOT_FOUND', 'errors.driverProfileNotFound');
  }

  // Guard: defer (never forbid) the switch while a customer could be
  // looking for the old moto — an active journey or an open bid. The
  // account-deletion anonymization write deliberately does NOT go
  // through this function: erasure bypasses the guard and the ledger.
  const activeJourney = await prisma.journey.findFirst({
    where: {
      driverId: userId,
      status: { in: ['MATCHED', 'IN_PROGRESS', 'AWAITING_CONFIRMATION'] },
    },
    select: { id: true },
  });
  const openBid = activeJourney
    ? null
    : await prisma.bid.findFirst({
        where: { driverId: userId, status: { in: ['PENDING', 'ACCEPTED'] } },
        select: { id: true },
      });
  if (activeJourney || openBid) {
    throw new AppError(409, 'VEHICLE_CHANGE_BLOCKED', 'errors.vehicleChangeBlocked');
  }

  // Snapshot the old values before the write — the ledger row must
  // record the true old -> new transition.
  const old = {
    vehicleType: profile.vehicleType,
    registrationPlate: profile.registrationPlate ?? null,
    vehicleDescription: profile.vehicleDescription,
  };
  const newVehicleType: VehicleType = data.vehicleType;
  const newPlate = data.registrationPlate ?? null;
  const changed =
    old.vehicleType !== newVehicleType ||
    old.registrationPlate !== newPlate ||
    old.vehicleDescription !== data.vehicleDescription;

  return prisma.$transaction(async (tx: any) => {
    const updated = await tx.driverProfile.update({
      where: { userId },
      data: {
        vehicleType: newVehicleType,
        registrationPlate: newPlate,
        vehicleDescription: data.vehicleDescription,
      },
    });
    if (changed) {
      await tx.vehicleChangeLog.create({
        data: {
          driverId: userId,
          oldVehicleType: old.vehicleType,
          newVehicleType: updated.vehicleType,
          oldPlate: old.registrationPlate,
          newPlate: updated.registrationPlate,
          oldDescription: old.vehicleDescription,
          newDescription: updated.vehicleDescription,
        },
      });
    }
    return updated;
  });
}

export async function updateDriverLocation(userId: string, lat: number, lng: number) {
  const driverProfile = await prisma.driverProfile.findUnique({
    where: { userId },
  });

  if (!driverProfile) {
    throw new AppError(404, 'DRIVER_PROFILE_NOT_FOUND', 'errors.driverProfileNotFound');
  }

  const updated = await prisma.driverProfile.update({
    where: { userId },
    data: {
      lastLat: lat,
      lastLng: lng,
      lastLocationAt: new Date(),
    },
  });

  return updated;
}

// R3-N-5 — driver account-status snapshot. Aggregates the counters
// touched by R3-N-1..4 (noShowCount, cancellationCount, lateMarkCount,
// wrongVehicleCount, driverInitiatedCancellationCount), the
// graduated-penalty state (suspendedUntil, isFlagged), the threshold
// constants exported from driver-penalty.ts, and the driver's recent
// DRIVER_NO_SHOW_DISPUTE filings joined to their AdminAction
// resolution rows. The account page consumes this shape verbatim.
export type DriverAccountStatusValue = 'ACTIVE' | 'SUSPENDED' | 'FLAGGED';

export interface DriverAccountStatus {
  status: DriverAccountStatusValue;
  suspendedUntil: string | null;
  isFlagged: boolean;
  counters: {
    noShowCount: number;
    cancellationCount: number;
    lateMarkCount: number;
    wrongVehicleCount: number;
    driverInitiatedCancellationCount: number;
    completedRides: number;
  };
  thresholds: {
    noShowWarning: number;
    noShowSuspension24h: number;
    noShowFlag: number;
  };
  recentDisputes: Array<{
    journeyId: string;
    cancelledAt: string | null;
    driverDisputedAt: string;
    resolution: {
      decision: 'OVERTURN_FLAG' | 'UPHOLD_FLAG' | 'NO_ACTION' | null;
      decidedAt: string | null;
      reason: string | null;
    };
  }>;
}

export async function getDriverAccountStatus(
  userId: string,
): Promise<DriverAccountStatus> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      noShowCount: true,
      cancellationCount: true,
      lateMarkCount: true,
      wrongVehicleCount: true,
      driverInitiatedCancellationCount: true,
      completedRides: true,
      isFlagged: true,
      suspendedUntil: true,
    },
  });
  if (!user) {
    throw new AppError(404, 'USER_NOT_FOUND', 'errors.userNotFound');
  }

  // FLAGGED is most severe and overrides any active suspension.
  let status: DriverAccountStatusValue = 'ACTIVE';
  if (user.isFlagged) {
    status = 'FLAGGED';
  } else if (user.suspendedUntil && user.suspendedUntil > new Date()) {
    status = 'SUSPENDED';
  }

  const journeys = await prisma.journey.findMany({
    where: {
      driverId: userId,
      cancelReason: 'DRIVER_NO_SHOW',
      driverDisputedAt: { not: null },
    },
    orderBy: { driverDisputedAt: 'desc' },
    take: 20,
    select: {
      id: true,
      cancelledAt: true,
      driverDisputedAt: true,
    },
  });

  const journeyIds: string[] = journeys.map((j: any) => j.id);
  const decisions = journeyIds.length
    ? await prisma.adminAction.findMany({
        where: {
          action: 'RESOLVE_DRIVER_NO_SHOW_DISPUTE',
          targetType: 'JOURNEY',
          targetId: { in: journeyIds },
        },
        select: {
          targetId: true,
          conflictDecision: true,
          createdAt: true,
          reason: true,
        },
      })
    : [];
  const decisionByJourney = new Map<string, any>(
    decisions.map((d: any) => [d.targetId, d]),
  );

  const recentDisputes = journeys.map((j: any) => {
    const d = decisionByJourney.get(j.id);
    return {
      journeyId: j.id,
      cancelledAt: j.cancelledAt ? j.cancelledAt.toISOString() : null,
      driverDisputedAt: j.driverDisputedAt!.toISOString(),
      resolution: {
        decision: d?.conflictDecision ?? null,
        decidedAt: d?.createdAt ? d.createdAt.toISOString() : null,
        reason: d?.reason ?? null,
      },
    };
  });

  return {
    status,
    suspendedUntil: user.suspendedUntil ? user.suspendedUntil.toISOString() : null,
    isFlagged: user.isFlagged,
    counters: {
      noShowCount: user.noShowCount,
      cancellationCount: user.cancellationCount,
      lateMarkCount: user.lateMarkCount,
      wrongVehicleCount: user.wrongVehicleCount,
      driverInitiatedCancellationCount: user.driverInitiatedCancellationCount,
      completedRides: user.completedRides,
    },
    thresholds: {
      noShowWarning: PENALTY_THRESHOLDS.WARNING_THRESHOLD,
      noShowSuspension24h: PENALTY_THRESHOLDS.SUSPENSION_24H_THRESHOLD,
      noShowFlag: PENALTY_THRESHOLDS.FLAG_THRESHOLD,
    },
    recentDisputes,
  };
}

export async function getPublicProfile(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { driverProfile: true },
  });

  if (!user) {
    throw new AppError(404, 'USER_NOT_FOUND', 'errors.userNotFound');
  }

  return {
    id: user.id,
    nickname: user.nickname,
    role: user.role,
    completedRides: user.completedRides,
    createdAt: user.createdAt,
    idVerified: user.idVerified,
    licenseVerified: user.licenseVerified,
    avgRating: user.driverProfile ? Number(user.driverProfile.avgRating) : undefined,
    totalRides: user.driverProfile?.totalRides,
    vehicleType: user.driverProfile?.vehicleType,
    vehicleDescription: user.driverProfile?.vehicleDescription,
    registrationPlate: user.driverProfile?.registrationPlate,
  };
}
