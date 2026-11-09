// SERVICES/AUTO-BID/RULES-STORE.TS
//
// CRUD + validation for DriverAutoBidRule. Defence-in-depth: routes
// validate at the request layer; the store re-validates the same
// invariants so any path that calls the store (tests, future jobs)
// stays inside the contract.
//
// Invariants enforced here:
//   - Max MAX_RULES_PER_DRIVER ENABLED rules per driver. Paused
//     (enabled=false) rules don't count toward the cap so a driver
//     can park a rule for later without deleting it.
//   - Priority is unique per driver (schema-level @@unique +
//     pre-check for a friendlier error).
//   - bidAmountValue must be inside the per-mode tier:
//       FLAT       → FLAT_BID_MIN_RWF..FLAT_BID_MAX_RWF
//       PERCENT    → PERCENT_BID_MIN..PERCENT_BID_MAX (i.e. % of fair price)
//   - Pickup / ride distance ranges sit inside the env-defined band.
//   - Cross-driver writes are forbidden: update/delete check that the
//     rule's driverId matches the caller.

import type { DriverAutoBidRule, PrismaClient } from '@prisma/client';
import {
  FLAT_BID_MAX_RWF,
  FLAT_BID_MIN_RWF,
  MAX_PICKUP_DISTANCE_M,
  MAX_RIDE_DISTANCE_M,
  MAX_RULES_PER_DRIVER,
  MIN_PICKUP_DISTANCE_M,
  MIN_RIDE_DISTANCE_M,
  PERCENT_BID_MAX,
  PERCENT_BID_MIN,
} from './config';
import { RuleStoreError, type RuleInput } from './types';

function validateBidAmount(
  mode: RuleInput['bidAmountMode'],
  value: number,
): void {
  if (mode === 'FLAT') {
    if (value < FLAT_BID_MIN_RWF || value > FLAT_BID_MAX_RWF) {
      throw new RuleStoreError(
        'INVALID_AMOUNT',
        `FLAT bid must be between ${FLAT_BID_MIN_RWF} and ${FLAT_BID_MAX_RWF} RWF`,
      );
    }
    return;
  }
  if (mode === 'PERCENT_OF_FAIR_PRICE') {
    if (value < PERCENT_BID_MIN || value > PERCENT_BID_MAX) {
      throw new RuleStoreError(
        'INVALID_AMOUNT',
        `PERCENT bid must be between ${PERCENT_BID_MIN} and ${PERCENT_BID_MAX}`,
      );
    }
    return;
  }
  throw new RuleStoreError('INVALID_AMOUNT', `unknown mode ${mode}`);
}

function validateDistances(input: Pick<RuleInput, 'maxPickupDistanceM' | 'maxRideDistanceM'>): void {
  if (
    input.maxPickupDistanceM < MIN_PICKUP_DISTANCE_M ||
    input.maxPickupDistanceM > MAX_PICKUP_DISTANCE_M
  ) {
    throw new RuleStoreError(
      'INVALID_DISTANCE',
      `maxPickupDistanceM must be between ${MIN_PICKUP_DISTANCE_M} and ${MAX_PICKUP_DISTANCE_M}`,
    );
  }
  if (
    input.maxRideDistanceM < MIN_RIDE_DISTANCE_M ||
    input.maxRideDistanceM > MAX_RIDE_DISTANCE_M
  ) {
    throw new RuleStoreError(
      'INVALID_DISTANCE',
      `maxRideDistanceM must be between ${MIN_RIDE_DISTANCE_M} and ${MAX_RIDE_DISTANCE_M}`,
    );
  }
}

function validatePriority(priority: number): void {
  if (
    !Number.isInteger(priority) ||
    priority < 0 ||
    priority >= MAX_RULES_PER_DRIVER
  ) {
    throw new RuleStoreError(
      'INVALID_PRIORITY',
      `priority must be an integer in [0, ${MAX_RULES_PER_DRIVER - 1}]`,
    );
  }
}

export async function listRulesForDriver(
  prisma: PrismaClient,
  driverId: string,
): Promise<DriverAutoBidRule[]> {
  return prisma.driverAutoBidRule.findMany({
    where: { driverId },
    orderBy: { priority: 'asc' },
  });
}

export async function createRule(
  prisma: PrismaClient,
  driverId: string,
  input: RuleInput,
): Promise<DriverAutoBidRule> {
  validatePriority(input.priority);
  validateDistances(input);
  validateBidAmount(input.bidAmountMode, input.bidAmountValue);

  // Cap on ENABLED rules. Paused rules don't count.
  if (input.enabled) {
    const enabledCount = await prisma.driverAutoBidRule.count({
      where: { driverId, enabled: true },
    });
    if (enabledCount >= MAX_RULES_PER_DRIVER) {
      throw new RuleStoreError(
        'TOO_MANY_RULES',
        `driver already has ${enabledCount} enabled rules (max ${MAX_RULES_PER_DRIVER})`,
      );
    }
  }

  const collision = await prisma.driverAutoBidRule.findUnique({
    where: { driverId_priority: { driverId, priority: input.priority } },
  });
  if (collision) {
    throw new RuleStoreError(
      'PRIORITY_TAKEN',
      `driver already has a rule at priority ${input.priority}`,
    );
  }

  return prisma.driverAutoBidRule.create({
    data: { driverId, ...input },
  });
}

export async function updateRule(
  prisma: PrismaClient,
  ruleId: string,
  driverId: string,
  input: Partial<RuleInput>,
): Promise<DriverAutoBidRule> {
  const existing = await prisma.driverAutoBidRule.findUnique({
    where: { id: ruleId },
  });
  if (!existing) {
    throw new RuleStoreError('RULE_NOT_FOUND', `rule ${ruleId} not found`);
  }
  if (existing.driverId !== driverId) {
    throw new RuleStoreError(
      'NOT_RULE_OWNER',
      `rule ${ruleId} does not belong to driver ${driverId}`,
    );
  }

  const merged: RuleInput = {
    priority: input.priority ?? existing.priority,
    enabled: input.enabled ?? existing.enabled,
    maxPickupDistanceM: input.maxPickupDistanceM ?? existing.maxPickupDistanceM,
    maxRideDistanceM: input.maxRideDistanceM ?? existing.maxRideDistanceM,
    vehicleTypeFilter:
      input.vehicleTypeFilter !== undefined
        ? input.vehicleTypeFilter
        : (existing.vehicleTypeFilter as RuleInput['vehicleTypeFilter']),
    bidAmountMode:
      (input.bidAmountMode ?? existing.bidAmountMode) as RuleInput['bidAmountMode'],
    bidAmountValue: input.bidAmountValue ?? existing.bidAmountValue,
  };

  validatePriority(merged.priority);
  validateDistances(merged);
  validateBidAmount(merged.bidAmountMode, merged.bidAmountValue);

  // If priority is changing, ensure no collision.
  if (merged.priority !== existing.priority) {
    const collision = await prisma.driverAutoBidRule.findUnique({
      where: { driverId_priority: { driverId, priority: merged.priority } },
    });
    if (collision) {
      throw new RuleStoreError(
        'PRIORITY_TAKEN',
        `driver already has a rule at priority ${merged.priority}`,
      );
    }
  }

  // Re-check enabled cap if a paused rule is being resumed.
  if (!existing.enabled && merged.enabled) {
    const enabledCount = await prisma.driverAutoBidRule.count({
      where: { driverId, enabled: true },
    });
    if (enabledCount >= MAX_RULES_PER_DRIVER) {
      throw new RuleStoreError(
        'TOO_MANY_RULES',
        `cannot resume — driver already has ${enabledCount} enabled rules`,
      );
    }
  }

  return prisma.driverAutoBidRule.update({
    where: { id: ruleId },
    data: merged,
  });
}

export async function deleteRule(
  prisma: PrismaClient,
  ruleId: string,
  driverId: string,
): Promise<void> {
  const existing = await prisma.driverAutoBidRule.findUnique({
    where: { id: ruleId },
  });
  if (!existing) {
    throw new RuleStoreError('RULE_NOT_FOUND', `rule ${ruleId} not found`);
  }
  if (existing.driverId !== driverId) {
    throw new RuleStoreError(
      'NOT_RULE_OWNER',
      `rule ${ruleId} does not belong to driver ${driverId}`,
    );
  }
  await prisma.driverAutoBidRule.delete({ where: { id: ruleId } });
}

export async function pauseAllRules(
  prisma: PrismaClient,
  driverId: string,
): Promise<{ paused: number }> {
  const result = await prisma.driverAutoBidRule.updateMany({
    where: { driverId, enabled: true },
    data: { enabled: false },
  });
  return { paused: result.count };
}

export async function resumeAllRules(
  prisma: PrismaClient,
  driverId: string,
): Promise<{ resumed: number }> {
  const result = await prisma.driverAutoBidRule.updateMany({
    where: { driverId, enabled: false },
    data: { enabled: true },
  });
  return { resumed: result.count };
}
