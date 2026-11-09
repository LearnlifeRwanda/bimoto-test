// Dispatch M — cooperative dispatch service. Manual on-behalf bid
// creation. The leader picks a driver and a customer; we create a
// real Journey + Bid pair so the customer's existing acceptBid path
// matches a dispatched bid the same way it matches any other bid.
//
// Critical invariants:
//   1. The driver MUST be in the leader's cooperative
//      (assertUserDriverInCooperative).
//   2. The driver MUST be online + verified + not frozen. These
//      checks happen here, BEFORE the transaction, so we never write
//      a Journey that can never be picked up.
//   3. Bid.dispatchedByLeaderId is the only new state. Existing
//      createBid / acceptBid / withdrawBid flow unchanged.
//   4. Audit row uses action='COOPERATIVE_DISPATCH' so an admin
//      reviewing the chain can distinguish dispatch from approval.

import type { PrismaClient } from '@prisma/client';
import { appendAdminActionTx } from '../admin/admin-action-audit.service';
import { assertUserDriverInCooperative, AuthorizationError } from './scope';
import {
  notifyBidReceived,
  notifyDriverOfNewlyAvailableJourney,
} from '../notification.service';
import {
  DISPATCH_DEFAULT_ETA_MINUTES,
  DISPATCH_DEFAULT_DISTANCE_KM,
} from './config';
import { estimatePrice } from '../fair-price.service';

export class DispatchValidationError extends Error {
  constructor(public code: string) {
    super(`DispatchValidationError: ${code}`);
  }
}

// Per-driver in-flight lock to prevent two leaders dispatching the same
// driver simultaneously. Lock TTL is 5 seconds (long enough to complete
// the tx, short enough to recover from a crashed dispatch). Process-local
// — adequate for single-instance deployments; multi-instance pilots
// should swap this for a Redis lock.
const driverDispatchLocks = new Map<string, number>();
const LOCK_TTL_MS = 5000;

export class DispatchInProgressError extends Error {
  constructor(public driverId: string) {
    super('driver-dispatch-in-progress');
  }
}

function tryAcquireDriverLock(driverId: string, now: number = Date.now()): boolean {
  const existing = driverDispatchLocks.get(driverId);
  if (existing && existing > now) return false;
  driverDispatchLocks.set(driverId, now + LOCK_TTL_MS);
  return true;
}

function releaseDriverLock(driverId: string): void {
  driverDispatchLocks.delete(driverId);
}

export function _resetDispatchLocksForTests(): void {
  driverDispatchLocks.clear();
}

export interface DispatchArgs {
  leaderUserId: string;
  cooperativeId: string;
  driverId: string;
  customerId: string;
  pickupLat: number;
  pickupLng: number;
  pickupName?: string;
  destinationLat: number;
  destinationLng: number;
  destinationName?: string;
  vehiclePreference: string;
  priceRwf?: number;
  etaMinutes?: number;
}

export interface DispatchResult {
  journeyId: string;
  bidId: string;
  driverId: string;
  customerId: string;
  priceRwf: number;
  etaMinutes: number;
  notifiedDriver: boolean;
  notifiedCustomer: boolean;
}

/**
 * Pre-flight validation that doesn't need a transaction. Throws
 * DispatchValidationError on driver/customer state issues so the
 * route layer can map to 422 with a structured code.
 */
async function preflightValidate(prisma: PrismaClient, args: DispatchArgs) {
  await assertUserDriverInCooperative(prisma, args.driverId, args.cooperativeId);

  const driverUser = await prisma.user.findUnique({
    where: { id: args.driverId },
  });
  if (!driverUser) {
    throw new DispatchValidationError('driver-not-found');
  }
  if (driverUser.frozenAt) {
    throw new DispatchValidationError('driver-frozen');
  }

  const driverProfile = await prisma.driverProfile.findUnique({
    where: { userId: args.driverId },
  });
  if (!driverProfile) {
    throw new DispatchValidationError('driver-profile-not-found');
  }
  if (driverProfile.active === false) {
    throw new DispatchValidationError('driver-inactive');
  }
  if (!driverProfile.isOnline) {
    throw new DispatchValidationError('driver-offline');
  }
  if (driverProfile.verificationStatus !== 'VERIFIED') {
    throw new DispatchValidationError('driver-not-verified');
  }
  if (
    args.vehiclePreference &&
    driverProfile.vehicleType !== args.vehiclePreference
  ) {
    throw new DispatchValidationError('vehicle-mismatch');
  }

  const customer = await prisma.user.findUnique({
    where: { id: args.customerId },
  });
  if (!customer) {
    throw new DispatchValidationError('customer-not-found');
  }
  if (customer.frozenAt) {
    throw new DispatchValidationError('customer-frozen');
  }

  return { driverUser, driverProfile, customer };
}

function resolvePrice(args: DispatchArgs): number {
  if (typeof args.priceRwf === 'number') {
    if (args.priceRwf <= 0) {
      throw new DispatchValidationError('invalid-price');
    }
    return Math.round(args.priceRwf);
  }
  // Fall back to fair-price midpoint of the configured default
  // distance — leader can always pass an explicit priceRwf when the
  // ride is unusual.
  const range = estimatePrice(DISPATCH_DEFAULT_DISTANCE_KM);
  return Math.round((range.min + range.max) / 2);
}

export async function dispatchBidOnBehalf(
  prisma: PrismaClient,
  args: DispatchArgs,
): Promise<DispatchResult> {
  if (!tryAcquireDriverLock(args.driverId)) {
    throw new DispatchInProgressError(args.driverId);
  }
  try {
    return await dispatchBidOnBehalfInner(prisma, args);
  } finally {
    releaseDriverLock(args.driverId);
  }
}

async function dispatchBidOnBehalfInner(
  prisma: PrismaClient,
  args: DispatchArgs,
): Promise<DispatchResult> {
  await preflightValidate(prisma, args);
  const priceRwf = resolvePrice(args);
  const etaMinutes = args.etaMinutes ?? DISPATCH_DEFAULT_ETA_MINUTES;

  const result = await prisma.$transaction(async (tx: any) => {
    const journey = await tx.journey.create({
      data: {
        customerId: args.customerId,
        type: 'PASSENGER',
        status: 'REQUESTED',
        pickupLat: args.pickupLat,
        pickupLng: args.pickupLng,
        pickupName: args.pickupName ?? 'Cooperative dispatch pickup',
        destinationLat: args.destinationLat,
        destinationLng: args.destinationLng,
        destinationName:
          args.destinationName ?? 'Cooperative dispatch destination',
        vehiclePreference: args.vehiclePreference,
        bookingMode: 'IMMEDIATE',
        requestMode: 'WAIT_AND_COMPARE',
        wishPrice: priceRwf,
      },
    });

    const bid = await tx.bid.create({
      data: {
        journeyId: journey.id,
        driverId: args.driverId,
        price: priceRwf,
        etaMinutes,
        status: 'PENDING',
        dispatchedByLeaderId: args.leaderUserId,
      },
    });

    const adminAction = await appendAdminActionTx(tx, {
      adminId: args.leaderUserId,
      action: 'COOPERATIVE_DISPATCH',
      targetType: 'JOURNEY',
      targetId: journey.id,
      reason: 'cooperative-leader-dispatch',
      payload: {
        cooperativeId: args.cooperativeId,
        driverId: args.driverId,
        customerId: args.customerId,
        priceRwf,
        etaMinutes,
        bidId: bid.id,
      },
    });

    return { journey, bid, adminAction };
  });

  // Best-effort post-tx notifications. Failure here doesn't roll back
  // the dispatch — leader can call again or the customer/driver can
  // proceed without a push.
  let notifiedDriver = false;
  let notifiedCustomer = false;
  try {
    notifyDriverOfNewlyAvailableJourney(args.driverId, result.journey.id);
    notifiedDriver = true;
  } catch (err) {
    console.warn('[M] dispatch-driver-notify-fail', err);
  }
  try {
    notifyBidReceived(args.customerId, result.journey.id, result.bid.id);
    notifiedCustomer = true;
  } catch (err) {
    console.warn('[M] dispatch-customer-notify-fail', err);
  }

  return {
    journeyId: result.journey.id,
    bidId: result.bid.id,
    driverId: args.driverId,
    customerId: args.customerId,
    priceRwf,
    etaMinutes,
    notifiedDriver,
    notifiedCustomer,
  };
}
