jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    journey: {
      findMany: jest.fn(),
    },
  },
}));

import prisma from '../prisma';
import {
  getFairPriceRange,
  urgencyMultiplier,
  vehicleTypeMultiplier,
  URGENCY_MULTIPLIER,
  PRIORITY_MULTIPLIER,
  childPassengerMultiplier,
  CHILD_PASSENGER_MULTIPLIER,
  parcelMultiplier,
  PARCEL_MULTIPLIER,
  largestParcelSize,
} from '../services/fair-price.service';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Fair Price Service', () => {
  test('returns null when fewer than 5 comparable rides exist', async () => {
    (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue([
      { agreedPrice: 1000 },
      { agreedPrice: 1200 },
      { agreedPrice: 1100 },
    ]);

    const result = await getFairPriceRange(3.0);
    expect(result).toBeNull();
  });

  test('returns valid range with sufficient data', async () => {
    const journeys = [
      { agreedPrice: 800 },
      { agreedPrice: 1000 },
      { agreedPrice: 1100 },
      { agreedPrice: 1200 },
      { agreedPrice: 1300 },
      { agreedPrice: 1400 },
      { agreedPrice: 1500 },
      { agreedPrice: 1600 },
      { agreedPrice: 1800 },
      { agreedPrice: 2500 },
    ];
    (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue(journeys);

    const result = await getFairPriceRange(3.0);

    expect(result).not.toBeNull();
    expect(result!.sampleSize).toBe(10);
    expect(result!.min).toBeDefined();
    expect(result!.max).toBeDefined();
    expect(result!.median).toBeDefined();
    expect(result!.min).toBeLessThanOrEqual(result!.median);
    expect(result!.median).toBeLessThanOrEqual(result!.max);
  });

  test('correctly trims outliers from the dataset', async () => {
    // 10 journeys: trim 1 from each end (10% of 10 = 1)
    const journeys = [
      { agreedPrice: 100 },   // trimmed (outlier low)
      { agreedPrice: 1000 },  // min after trim
      { agreedPrice: 1100 },
      { agreedPrice: 1200 },
      { agreedPrice: 1300 },
      { agreedPrice: 1400 },
      { agreedPrice: 1500 },
      { agreedPrice: 1600 },
      { agreedPrice: 1800 },  // max after trim
      { agreedPrice: 10000 }, // trimmed (outlier high)
    ];
    (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue(journeys);

    const result = await getFairPriceRange(3.0);

    expect(result).not.toBeNull();
    expect(result!.min).toBe(1000);
    expect(result!.max).toBe(1800);
  });

  test('returns exactly 5 journeys minimum for valid range', async () => {
    const journeys = [
      { agreedPrice: 1000 },
      { agreedPrice: 1100 },
      { agreedPrice: 1200 },
      { agreedPrice: 1300 },
      { agreedPrice: 1400 },
    ];
    (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue(journeys);

    const result = await getFairPriceRange(3.0);

    expect(result).not.toBeNull();
    expect(result!.sampleSize).toBe(5);
  });

  // R3-V — per-vehicle-type fare-band multipliers.
  describe('per-vehicle-type multiplier', () => {
    const journeys = [
      { agreedPrice: 800 },
      { agreedPrice: 1000 },
      { agreedPrice: 1100 },
      { agreedPrice: 1200 },
      { agreedPrice: 1300 },
      { agreedPrice: 1400 },
      { agreedPrice: 1500 },
      { agreedPrice: 1600 },
      { agreedPrice: 1800 },
      { agreedPrice: 2500 },
    ];

    test('vehicleTypeMultiplier returns 1.0 for null/undefined', () => {
      expect(vehicleTypeMultiplier(null)).toBe(1.0);
      expect(vehicleTypeMultiplier(undefined)).toBe(1.0);
    });

    test('BIKE multiplier returns ~70% of MOTO range', async () => {
      (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue(journeys);
      const moto = await getFairPriceRange(3.0, 1.0, 'MOTO');
      (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue(journeys);
      const bike = await getFairPriceRange(3.0, 1.0, 'BIKE');
      expect(moto).not.toBeNull();
      expect(bike).not.toBeNull();
      expect(bike!.median).toBe(Math.round(moto!.median * 0.7));
      expect(bike!.min).toBe(Math.round(moto!.min * 0.7));
      expect(bike!.max).toBe(Math.round(moto!.max * 0.7));
    });

    test('E_BIKE multiplier returns ~85% of MOTO range', async () => {
      (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue(journeys);
      const moto = await getFairPriceRange(3.0, 1.0, 'MOTO');
      (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue(journeys);
      const ebike = await getFairPriceRange(3.0, 1.0, 'E_BIKE');
      expect(ebike!.median).toBe(Math.round(moto!.median * 0.85));
    });

    test('E_MOTO multiplier returns ~105% of MOTO range', async () => {
      (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue(journeys);
      const moto = await getFairPriceRange(3.0, 1.0, 'MOTO');
      (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue(journeys);
      const emoto = await getFairPriceRange(3.0, 1.0, 'E_MOTO');
      expect(emoto!.median).toBe(Math.round(moto!.median * 1.05));
    });

    test('missing vehicleType is identical to MOTO multiplier (1.0)', async () => {
      (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue(journeys);
      const noType = await getFairPriceRange(3.0);
      (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue(journeys);
      const moto = await getFairPriceRange(3.0, 1.0, 'MOTO');
      expect(noType!.median).toBe(moto!.median);
      expect(noType!.min).toBe(moto!.min);
      expect(noType!.max).toBe(moto!.max);
    });
  });

  // R3-T — urgency premium composes with the R3-V vehicle multiplier.
  describe('urgency premium (R3-T)', () => {
    const journeys = [
      { agreedPrice: 800 },
      { agreedPrice: 1000 },
      { agreedPrice: 1100 },
      { agreedPrice: 1200 },
      { agreedPrice: 1300 },
      { agreedPrice: 1400 },
      { agreedPrice: 1500 },
      { agreedPrice: 1600 },
      { agreedPrice: 1800 },
      { agreedPrice: 2500 },
    ];

    test('urgencyMultiplier returns 1.0 / 1.15 / 1.3 by JourneyType', () => {
      expect(urgencyMultiplier(null)).toBe(1.0);
      expect(urgencyMultiplier(undefined)).toBe(1.0);
      expect(urgencyMultiplier('PASSENGER')).toBe(1.0);
      expect(urgencyMultiplier('GOODS')).toBe(1.0);
      expect(urgencyMultiplier('PRIORITY_MESSENGER')).toBe(PRIORITY_MULTIPLIER);
      expect(urgencyMultiplier('URGENT_MESSENGER')).toBe(URGENCY_MULTIPLIER);
      expect(URGENCY_MULTIPLIER).toBe(1.3);
      expect(PRIORITY_MULTIPLIER).toBe(1.15);
    });

    test('URGENT_MESSENGER on MOTO multiplies the band by 1.3', async () => {
      (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue(journeys);
      const motoStandard = await getFairPriceRange(3.0, 1.0, 'MOTO');
      (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue(journeys);
      const motoUrgent = await getFairPriceRange(3.0, 1.0, 'MOTO', 'URGENT_MESSENGER');
      expect(motoUrgent!.median).toBe(Math.round(motoStandard!.median * 1.3));
      expect(motoUrgent!.min).toBe(Math.round(motoStandard!.min * 1.3));
      expect(motoUrgent!.max).toBe(Math.round(motoStandard!.max * 1.3));
    });

    test('BIKE urgent composes both multipliers (0.7 * 1.3 = 0.91 of MOTO standard)', async () => {
      (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue(journeys);
      const motoStandard = await getFairPriceRange(3.0, 1.0, 'MOTO');
      (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue(journeys);
      const bikeUrgent = await getFairPriceRange(3.0, 1.0, 'BIKE', 'URGENT_MESSENGER');
      // Both multipliers applied compositionally — not just urgency.
      expect(bikeUrgent!.median).toBe(Math.round(motoStandard!.median * 0.7 * 1.3));
      expect(bikeUrgent!.min).toBe(Math.round(motoStandard!.min * 0.7 * 1.3));
      expect(bikeUrgent!.max).toBe(Math.round(motoStandard!.max * 0.7 * 1.3));
    });
  });

  // R3-PRIORITY — intermediate-tier multiplier (1.15x).
  describe('priority premium (R3-PRIORITY)', () => {
    const journeys = [
      { agreedPrice: 800 },
      { agreedPrice: 1000 },
      { agreedPrice: 1100 },
      { agreedPrice: 1200 },
      { agreedPrice: 1300 },
      { agreedPrice: 1400 },
      { agreedPrice: 1500 },
      { agreedPrice: 1600 },
      { agreedPrice: 1800 },
      { agreedPrice: 2500 },
    ];

    test('PRIORITY_MESSENGER on MOTO multiplies the band by 1.15', async () => {
      (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue(journeys);
      const motoStandard = await getFairPriceRange(3.0, 1.0, 'MOTO');
      (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue(journeys);
      const motoPriority = await getFairPriceRange(3.0, 1.0, 'MOTO', 'PRIORITY_MESSENGER');
      expect(motoPriority!.median).toBe(Math.round(motoStandard!.median * 1.15));
      expect(motoPriority!.min).toBe(Math.round(motoStandard!.min * 1.15));
      expect(motoPriority!.max).toBe(Math.round(motoStandard!.max * 1.15));
    });

    test('BIKE × PRIORITY composes (0.7 * 1.15 = 0.805 of MOTO standard)', async () => {
      (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue(journeys);
      const motoStandard = await getFairPriceRange(3.0, 1.0, 'MOTO');
      (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue(journeys);
      const bikePriority = await getFairPriceRange(3.0, 1.0, 'BIKE', 'PRIORITY_MESSENGER');
      expect(bikePriority!.median).toBe(Math.round(motoStandard!.median * 0.7 * 1.15));
      expect(bikePriority!.min).toBe(Math.round(motoStandard!.min * 0.7 * 1.15));
      expect(bikePriority!.max).toBe(Math.round(motoStandard!.max * 0.7 * 1.15));
    });

    test('PASSENGER / GOODS leave the band identical to no-tier', async () => {
      (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue(journeys);
      const baseline = await getFairPriceRange(3.0, 1.0, 'MOTO');
      (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue(journeys);
      const passenger = await getFairPriceRange(3.0, 1.0, 'MOTO', 'PASSENGER');
      expect(passenger!.median).toBe(baseline!.median);
      expect(passenger!.min).toBe(baseline!.min);
      expect(passenger!.max).toBe(baseline!.max);
    });
  });

  // R3-CHILD — child-passenger premium composes with vehicle + urgency.
  describe('child-passenger premium (R3-CHILD)', () => {
    const journeys = [
      { agreedPrice: 800 },
      { agreedPrice: 1000 },
      { agreedPrice: 1100 },
      { agreedPrice: 1200 },
      { agreedPrice: 1300 },
      { agreedPrice: 1400 },
      { agreedPrice: 1500 },
      { agreedPrice: 1600 },
      { agreedPrice: 1800 },
      { agreedPrice: 2500 },
    ];

    test('childPassengerMultiplier returns 1.0 / 1.1 with the right shape', () => {
      expect(childPassengerMultiplier(null)).toBe(1.0);
      expect(childPassengerMultiplier(undefined)).toBe(1.0);
      expect(childPassengerMultiplier(false)).toBe(1.0);
      expect(childPassengerMultiplier(true)).toBe(CHILD_PASSENGER_MULTIPLIER);
      expect(CHILD_PASSENGER_MULTIPLIER).toBe(1.1);
    });

    test('hasChildPassenger=true on MOTO multiplies the band by 1.1', async () => {
      (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue(journeys);
      const standard = await getFairPriceRange(3.0, 1.0, 'MOTO');
      (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue(journeys);
      const child = await getFairPriceRange(3.0, 1.0, 'MOTO', null, true);
      expect(child!.median).toBe(Math.round(standard!.median * 1.1));
      expect(child!.min).toBe(Math.round(standard!.min * 1.1));
      expect(child!.max).toBe(Math.round(standard!.max * 1.1));
    });

    test('child + vehicle + urgency compose multiplicatively (BIKE × URGENT × CHILD = 0.7 × 1.3 × 1.1)', async () => {
      (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue(journeys);
      const standard = await getFairPriceRange(3.0, 1.0, 'MOTO');
      (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue(journeys);
      const composite = await getFairPriceRange(3.0, 1.0, 'BIKE', 'URGENT_MESSENGER', true);
      expect(composite!.median).toBe(Math.round(standard!.median * 0.7 * 1.3 * 1.1));
      expect(composite!.min).toBe(Math.round(standard!.min * 0.7 * 1.3 * 1.1));
      expect(composite!.max).toBe(Math.round(standard!.max * 0.7 * 1.3 * 1.1));
    });

    test('hasChildPassenger=false leaves the band identical to the no-child path', async () => {
      (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue(journeys);
      const noChild = await getFairPriceRange(3.0, 1.0, 'MOTO', null, false);
      (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue(journeys);
      const baseline = await getFairPriceRange(3.0, 1.0, 'MOTO');
      expect(noChild!.median).toBe(baseline!.median);
      expect(noChild!.min).toBe(baseline!.min);
      expect(noChild!.max).toBe(baseline!.max);
    });
  });

  // R3-DELIVERY — parcel-size premium composes with vehicle + urgency + child.
  describe('parcel-size premium (R3-DELIVERY)', () => {
    const journeys = [
      { agreedPrice: 800 },
      { agreedPrice: 1000 },
      { agreedPrice: 1100 },
      { agreedPrice: 1200 },
      { agreedPrice: 1300 },
      { agreedPrice: 1400 },
      { agreedPrice: 1500 },
      { agreedPrice: 1600 },
      { agreedPrice: 1800 },
      { agreedPrice: 2500 },
    ];

    test('parcelMultiplier returns 1.0 for null/undefined and per-size values for SMALL/MEDIUM/LARGE', () => {
      expect(parcelMultiplier(null)).toBe(1.0);
      expect(parcelMultiplier(undefined)).toBe(1.0);
      expect(parcelMultiplier('SMALL')).toBe(1.0);
      expect(parcelMultiplier('MEDIUM')).toBe(1.1);
      expect(parcelMultiplier('LARGE')).toBe(1.25);
      expect(PARCEL_MULTIPLIER.SMALL).toBe(1.0);
      expect(PARCEL_MULTIPLIER.MEDIUM).toBe(1.1);
      expect(PARCEL_MULTIPLIER.LARGE).toBe(1.25);
    });

    test('SMALL parcel does not change the band (multiplier=1.0)', async () => {
      (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue(journeys);
      const baseline = await getFairPriceRange(3.0, 1.0, 'MOTO');
      (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue(journeys);
      const small = await getFairPriceRange(3.0, 1.0, 'MOTO', null, false, 'SMALL');
      expect(small!.median).toBe(baseline!.median);
      expect(small!.min).toBe(baseline!.min);
      expect(small!.max).toBe(baseline!.max);
    });

    test('LARGE parcel on MOTO multiplies the band by 1.25', async () => {
      (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue(journeys);
      const baseline = await getFairPriceRange(3.0, 1.0, 'MOTO');
      (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue(journeys);
      const large = await getFairPriceRange(3.0, 1.0, 'MOTO', null, false, 'LARGE');
      expect(large!.median).toBe(Math.round(baseline!.median * 1.25));
      expect(large!.min).toBe(Math.round(baseline!.min * 1.25));
      expect(large!.max).toBe(Math.round(baseline!.max * 1.25));
    });

    test('4-axis composition: BIKE × URGENT × CHILD × LARGE = 0.7 × 1.3 × 1.1 × 1.25', async () => {
      (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue(journeys);
      const baseline = await getFairPriceRange(3.0, 1.0, 'MOTO');
      (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue(journeys);
      const composite = await getFairPriceRange(3.0, 1.0, 'BIKE', 'URGENT_MESSENGER', true, 'LARGE');
      expect(composite!.median).toBe(
        Math.round(baseline!.median * 0.7 * 1.3 * 1.1 * 1.25),
      );
      expect(composite!.min).toBe(
        Math.round(baseline!.min * 0.7 * 1.3 * 1.1 * 1.25),
      );
      expect(composite!.max).toBe(
        Math.round(baseline!.max * 0.7 * 1.3 * 1.1 * 1.25),
      );
    });

    test('4-axis composition: BIKE × PRIORITY × CHILD × LARGE = 0.7 × 1.15 × 1.1 × 1.25', async () => {
      (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue(journeys);
      const baseline = await getFairPriceRange(3.0, 1.0, 'MOTO');
      (mockPrisma.journey.findMany as jest.Mock).mockResolvedValue(journeys);
      const composite = await getFairPriceRange(3.0, 1.0, 'BIKE', 'PRIORITY_MESSENGER', true, 'LARGE');
      expect(composite!.median).toBe(
        Math.round(baseline!.median * 0.7 * 1.15 * 1.1 * 1.25),
      );
      expect(composite!.min).toBe(
        Math.round(baseline!.min * 0.7 * 1.15 * 1.1 * 1.25),
      );
      expect(composite!.max).toBe(
        Math.round(baseline!.max * 0.7 * 1.15 * 1.1 * 1.25),
      );
    });

    test('largestParcelSize returns null for empty/non-goods legs and the largest size otherwise', () => {
      expect(largestParcelSize([])).toBeNull();
      expect(largestParcelSize([{ parcelSize: null }, { parcelSize: undefined }])).toBeNull();
      expect(largestParcelSize([{ parcelSize: 'SMALL' }])).toBe('SMALL');
      expect(largestParcelSize([{ parcelSize: 'SMALL' }, { parcelSize: 'MEDIUM' }])).toBe('MEDIUM');
      expect(
        largestParcelSize([
          { parcelSize: 'SMALL' },
          { parcelSize: 'LARGE' },
          { parcelSize: 'MEDIUM' },
        ]),
      ).toBe('LARGE');
    });
  });
});
