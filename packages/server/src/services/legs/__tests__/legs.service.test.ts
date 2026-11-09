// R3-LEGS — validator + service tests for the multi-stop foundation.
// The validator tests are pure functions; the service tests mock the
// prisma client to verify createMany/updateMany payloads without a
// live DB.

jest.mock('../../../prisma', () => {
  const updateManyMock = jest.fn();
  const createManyMock = jest.fn();
  const findManyMock = jest.fn();
  const findUniqueLegMock = jest.fn().mockResolvedValue(null);
  const findUniqueJourneyMock = jest.fn().mockResolvedValue(null);
  return {
    __esModule: true,
    default: {
      leg: {
        updateMany: updateManyMock,
        createMany: createManyMock,
        findMany: findManyMock,
        findUnique: findUniqueLegMock,
      },
      journey: {
        findUnique: findUniqueJourneyMock,
      },
    },
  };
});

import {
  validateLegSequence,
  createLegsForJourney,
  markLegCompleted,
  getJourneyLegs,
} from '../legs.service';
import prisma from '../../../prisma';
import type { LegInput } from '@bimoto/shared';

const baseLeg: LegInput = {
  type: 'GOODS_DROPOFF',
  lat: -1.95,
  lng: 30.06,
  name: 'Post office',
  parcelSize: 'SMALL',
};

describe('R3-LEGS — validateLegSequence', () => {
  it('empty legs is always valid (single-leg journey)', () => {
    expect(validateLegSequence([])).toEqual({ valid: true });
  });

  it('valid 2-leg sequence passes', () => {
    const result = validateLegSequence([
      { type: 'GOODS_DROPOFF', lat: -1.95, lng: 30.06, name: 'Post office', parcelSize: 'SMALL' },
      { type: 'PASSENGER_DROPOFF', lat: -1.94, lng: 30.07, name: 'Office' },
    ]);
    expect(result.valid).toBe(true);
  });

  it('WAIT at first position is rejected with WAIT_AT_BOUNDARY', () => {
    const result = validateLegSequence([
      { type: 'WAIT', lat: -1.95, lng: 30.06, name: 'Wait' },
      { type: 'PASSENGER_DROPOFF', lat: -1.94, lng: 30.07, name: 'Office' },
    ]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe('WAIT_AT_BOUNDARY');
    }
  });

  it('WAIT at last position is rejected with WAIT_AT_BOUNDARY', () => {
    const result = validateLegSequence([
      { type: 'GOODS_DROPOFF', lat: -1.95, lng: 30.06, name: 'Post office', parcelSize: 'SMALL' },
      { type: 'WAIT', lat: -1.94, lng: 30.07, name: 'Wait' },
    ]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe('WAIT_AT_BOUNDARY');
    }
  });

  it('WAIT in the middle is allowed', () => {
    const result = validateLegSequence([
      { type: 'GOODS_DROPOFF', lat: -1.95, lng: 30.06, name: 'Post office', parcelSize: 'SMALL' },
      { type: 'WAIT', lat: -1.94, lng: 30.07, name: 'Wait at corner' },
      { type: 'PASSENGER_DROPOFF', lat: -1.93, lng: 30.08, name: 'Office' },
    ]);
    expect(result.valid).toBe(true);
  });

  it('invalid lat is rejected with INVALID_LAT_LNG', () => {
    const result = validateLegSequence([{ ...baseLeg, lat: 200 }]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe('INVALID_LAT_LNG');
    }
  });

  it('invalid lng is rejected with INVALID_LAT_LNG', () => {
    const result = validateLegSequence([{ ...baseLeg, lng: 400 }]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe('INVALID_LAT_LNG');
    }
  });

  it('whitespace-only name is rejected with EMPTY_NAME', () => {
    const result = validateLegSequence([{ ...baseLeg, name: '   ' }]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe('EMPTY_NAME');
    }
  });

  it('empty name is rejected with EMPTY_NAME', () => {
    const result = validateLegSequence([{ ...baseLeg, name: '' }]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe('EMPTY_NAME');
    }
  });

  // R3-DELIVERY — parcelSize × LegType cross-validation.
  it('GOODS_DROPOFF without parcelSize is rejected with PARCEL_SIZE_REQUIRED_FOR_GOODS_LEG', () => {
    const result = validateLegSequence([
      { type: 'GOODS_DROPOFF', lat: -1.95, lng: 30.06, name: 'Post office' },
      { type: 'PASSENGER_DROPOFF', lat: -1.94, lng: 30.07, name: 'Office' },
    ]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe('PARCEL_SIZE_REQUIRED_FOR_GOODS_LEG');
    }
  });

  it('GOODS_PICKUP without parcelSize is rejected with PARCEL_SIZE_REQUIRED_FOR_GOODS_LEG', () => {
    const result = validateLegSequence([
      { type: 'GOODS_PICKUP', lat: -1.95, lng: 30.06, name: 'Warehouse' },
      { type: 'PASSENGER_DROPOFF', lat: -1.94, lng: 30.07, name: 'Office' },
    ]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe('PARCEL_SIZE_REQUIRED_FOR_GOODS_LEG');
    }
  });

  it('GOODS_DROPOFF with parcelSize: MEDIUM is valid', () => {
    const result = validateLegSequence([
      { type: 'GOODS_DROPOFF', lat: -1.95, lng: 30.06, name: 'Post office', parcelSize: 'MEDIUM' },
      { type: 'PASSENGER_DROPOFF', lat: -1.94, lng: 30.07, name: 'Office' },
    ]);
    expect(result.valid).toBe(true);
  });

  it('PASSENGER_DROPOFF with parcelSize is rejected with PARCEL_SIZE_ON_NON_GOODS_LEG', () => {
    const result = validateLegSequence([
      { type: 'PASSENGER_PICKUP', lat: -1.95, lng: 30.06, name: 'Home' },
      { type: 'PASSENGER_DROPOFF', lat: -1.94, lng: 30.07, name: 'Office', parcelSize: 'SMALL' },
    ]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe('PARCEL_SIZE_ON_NON_GOODS_LEG');
    }
  });

  it('WAIT with parcelSize is rejected with PARCEL_SIZE_ON_NON_GOODS_LEG', () => {
    const result = validateLegSequence([
      { type: 'GOODS_DROPOFF', lat: -1.95, lng: 30.06, name: 'Post office', parcelSize: 'SMALL' },
      { type: 'WAIT', lat: -1.94, lng: 30.07, name: 'Wait', parcelSize: 'SMALL' },
      { type: 'PASSENGER_DROPOFF', lat: -1.93, lng: 30.08, name: 'Office' },
    ]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe('PARCEL_SIZE_ON_NON_GOODS_LEG');
    }
  });

  // R3-DELIVERY-V2 — parcelCategory cross-validation. Optional even
  // on goods legs (UI defaults to OTHER); forbidden on non-goods legs.
  it('GOODS_DROPOFF with parcelCategory: FRAGILE is valid', () => {
    const result = validateLegSequence([
      {
        type: 'GOODS_DROPOFF',
        lat: -1.95,
        lng: 30.06,
        name: 'Post office',
        parcelSize: 'SMALL',
        parcelCategory: 'FRAGILE',
      },
    ]);
    expect(result.valid).toBe(true);
  });

  it('GOODS_DROPOFF without parcelCategory is valid (category is optional)', () => {
    const result = validateLegSequence([
      {
        type: 'GOODS_DROPOFF',
        lat: -1.95,
        lng: 30.06,
        name: 'Post office',
        parcelSize: 'SMALL',
      },
    ]);
    expect(result.valid).toBe(true);
  });

  it('PASSENGER_PICKUP with parcelCategory is rejected with PARCEL_CATEGORY_ON_NON_GOODS_LEG', () => {
    const result = validateLegSequence([
      {
        type: 'PASSENGER_PICKUP',
        lat: -1.95,
        lng: 30.06,
        name: 'Pickup',
        parcelCategory: 'FRAGILE',
      },
    ]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe('PARCEL_CATEGORY_ON_NON_GOODS_LEG');
    }
  });

  it('WAIT with parcelCategory is rejected with PARCEL_CATEGORY_ON_NON_GOODS_LEG', () => {
    const result = validateLegSequence([
      {
        type: 'GOODS_DROPOFF',
        lat: -1.95,
        lng: 30.06,
        name: 'Post office',
        parcelSize: 'SMALL',
      },
      {
        type: 'WAIT',
        lat: -1.94,
        lng: 30.07,
        name: 'Wait',
        parcelCategory: 'OTHER',
      },
      {
        type: 'PASSENGER_DROPOFF',
        lat: -1.93,
        lng: 30.08,
        name: 'Office',
      },
    ]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe('PARCEL_CATEGORY_ON_NON_GOODS_LEG');
    }
  });
});

describe('R3-LEGS — createLegsForJourney', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates legs with sequential 0-indexed sequence', async () => {
    const tx: any = {
      leg: { createMany: jest.fn().mockResolvedValue({ count: 3 }) },
    };
    const legs: LegInput[] = [
      { type: 'GOODS_PICKUP', lat: -1.95, lng: 30.06, name: 'A', parcelSize: 'SMALL' },
      { type: 'GOODS_DROPOFF', lat: -1.94, lng: 30.07, name: 'B', parcelSize: 'MEDIUM' },
      { type: 'PASSENGER_DROPOFF', lat: -1.93, lng: 30.08, name: 'C' },
    ];
    await createLegsForJourney(tx, 'jid-1', legs);
    expect(tx.leg.createMany).toHaveBeenCalledTimes(1);
    const payload = tx.leg.createMany.mock.calls[0][0].data;
    expect(payload).toHaveLength(3);
    expect(payload[0].sequence).toBe(0);
    expect(payload[1].sequence).toBe(1);
    expect(payload[2].sequence).toBe(2);
    expect(payload[0].journeyId).toBe('jid-1');
    expect(payload[0].name).toBe('A');
    expect(payload[1].name).toBe('B');
    expect(payload[2].name).toBe('C');
  });

  it('empty input creates no legs (no-op)', async () => {
    const tx: any = {
      leg: { createMany: jest.fn() },
    };
    await createLegsForJourney(tx, 'jid-1', []);
    expect(tx.leg.createMany).not.toHaveBeenCalled();
  });

  it('passes optional fields through with null defaults', async () => {
    const tx: any = {
      leg: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const legs: LegInput[] = [
      {
        type: 'GOODS_DROPOFF',
        lat: -1.95,
        lng: 30.06,
        name: 'A',
        contactName: 'Alice',
        contactPhone: '+250788000000',
        expectedDurationMinutes: 5,
        parcelSize: 'LARGE',
        parcelCategory: 'FRAGILE',
      },
    ];
    await createLegsForJourney(tx, 'jid-1', legs);
    const payload = tx.leg.createMany.mock.calls[0][0].data[0];
    expect(payload.contactName).toBe('Alice');
    expect(payload.contactPhone).toBe('+250788000000');
    expect(payload.expectedDurationMinutes).toBe(5);
    expect(payload.parcelSize).toBe('LARGE');
    expect(payload.parcelCategory).toBe('FRAGILE');
  });

  it('defaults parcelCategory to null when omitted', async () => {
    const tx: any = {
      leg: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    await createLegsForJourney(tx, 'jid-1', [
      {
        type: 'GOODS_DROPOFF',
        lat: -1.95,
        lng: 30.06,
        name: 'A',
        parcelSize: 'SMALL',
      },
    ]);
    const payload = tx.leg.createMany.mock.calls[0][0].data[0];
    expect(payload.parcelCategory).toBeNull();
  });

  it('defaults missing optional fields to null', async () => {
    const tx: any = {
      leg: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    // baseLeg has parcelSize: 'SMALL'; verify the create payload retains it.
    await createLegsForJourney(tx, 'jid-1', [baseLeg]);
    const payload = tx.leg.createMany.mock.calls[0][0].data[0];
    expect(payload.contactName).toBeNull();
    expect(payload.contactPhone).toBeNull();
    expect(payload.expectedDurationMinutes).toBeNull();
    expect(payload.parcelSize).toBe('SMALL');
  });

  it('defaults parcelSize to null when omitted (non-goods legs)', async () => {
    const tx: any = {
      leg: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    await createLegsForJourney(tx, 'jid-1', [
      { type: 'PASSENGER_DROPOFF', lat: -1.95, lng: 30.06, name: 'Office' },
    ]);
    const payload = tx.leg.createMany.mock.calls[0][0].data[0];
    expect(payload.parcelSize).toBeNull();
  });
});

describe('R3-LEGS — markLegCompleted', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('updates the leg with COMPLETED status and completedAt timestamp', async () => {
    (prisma.leg.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    await markLegCompleted('leg-1', 'journey-1');
    expect(prisma.leg.updateMany).toHaveBeenCalledTimes(1);
    const args = (prisma.leg.updateMany as jest.Mock).mock.calls[0][0];
    expect(args.where).toEqual({ id: 'leg-1', journeyId: 'journey-1' });
    expect(args.data.status).toBe('COMPLETED');
    expect(args.data.completedAt).toBeInstanceOf(Date);
  });

  it('throws when no leg matches the composite (legId, journeyId) where', async () => {
    (prisma.leg.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    await expect(markLegCompleted('leg-x', 'journey-y')).rejects.toThrow(
      'Leg not found for journey',
    );
  });
});

describe('R3-LEGS — getJourneyLegs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('fetches legs sorted by sequence ascending', async () => {
    (prisma.leg.findMany as jest.Mock).mockResolvedValue([]);
    await getJourneyLegs('journey-1');
    expect(prisma.leg.findMany).toHaveBeenCalledWith({
      where: { journeyId: 'journey-1' },
      orderBy: { sequence: 'asc' },
    });
  });
});
