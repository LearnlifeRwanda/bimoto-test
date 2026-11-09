// SERVICES/CUSTOMER-MODES/__TESTS__/SUGGEST-UP.TEST.TS
//
// Dispatch K3 group 3 — pure validation tier rules + applySuggestUp
// happy path including Socket.io emit + getSuggestUpStatus tier reveals.

import {
  validateSuggestUp,
  applySuggestUp,
  getSuggestUpStatus,
} from '../suggest-up';

const T0 = new Date('2026-05-05T17:00:00.000Z');
const t = (offsetSec: number) => new Date(T0.getTime() + offsetSec * 1000);

function makeJourney(overrides: Partial<any> = {}) {
  return {
    id: 'j1',
    customerId: 'c1',
    status: 'REQUESTED',
    discoveryStartedAt: T0,
    suggestUpCount: 0,
    wishPrice: 1500,
    ...overrides,
  };
}

describe('validateSuggestUp', () => {
  it('addRwf=50 at 60s → valid', () => {
    const r = validateSuggestUp(makeJourney(), 'c1', 50, t(60));
    expect(r.valid).toBe(true);
    expect(r.reason).toBe('ok');
  });

  it('addRwf=50 at 30s → too-early', () => {
    const r = validateSuggestUp(makeJourney(), 'c1', 50, t(30));
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('too-early');
  });

  it('addRwf=100 at 60s → amount-not-yet-available', () => {
    const r = validateSuggestUp(makeJourney(), 'c1', 100, t(60));
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('amount-not-yet-available');
  });

  it('addRwf=100 at 120s → valid', () => {
    const r = validateSuggestUp(makeJourney(), 'c1', 100, t(120));
    expect(r.valid).toBe(true);
  });

  it('addRwf=75 (not in config) → invalid-amount', () => {
    const r = validateSuggestUp(makeJourney(), 'c1', 75, t(60));
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('invalid-amount');
  });

  it('non-owner customerId → not-owner', () => {
    const r = validateSuggestUp(makeJourney(), 'OTHER', 50, t(60));
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('not-owner');
  });

  it('journey already MATCHED → journey-not-open', () => {
    const r = validateSuggestUp(makeJourney({ status: 'MATCHED' }), 'c1', 50, t(60));
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('journey-not-open');
  });
});

describe('applySuggestUp', () => {
  it('happy path: wishPrice 1500 → 1550, suggestUpCount 0 → 1, emits Socket event', async () => {
    const updated = {
      id: 'j1',
      wishPrice: 1550,
      suggestUpCount: 1,
    };
    const prisma: any = {
      journey: {
        findUnique: jest.fn(async () => ({
          id: 'j1',
          customerId: 'c1',
          status: 'REQUESTED',
          discoveryStartedAt: T0,
          suggestUpCount: 0,
          wishPrice: 1500,
        })),
        update: jest.fn(async () => updated),
      },
    };
    const emit = jest.fn();
    const to = jest.fn(() => ({ emit }));
    const io: any = { to };

    const result = await applySuggestUp(prisma, io, 'j1', 'c1', 50, t(70));

    expect(result.newWishPrice).toBe(1550);
    expect(result.suggestUpCount).toBe(1);
    expect(prisma.journey.update).toHaveBeenCalledWith({
      where: { id: 'j1' },
      data: { wishPrice: 1550, suggestUpCount: { increment: 1 } },
    });
    expect(to).toHaveBeenCalledWith('journey:j1');
    expect(emit).toHaveBeenCalledWith(
      'journey:wish-price-updated',
      expect.objectContaining({
        journeyId: 'j1',
        wishPrice: 1550,
        suggestUpCount: 1,
        addRwf: 50,
      }),
    );
  });

  it('throws when validation fails (e.g. too-early)', async () => {
    const prisma: any = {
      journey: {
        findUnique: jest.fn(async () => ({
          id: 'j1',
          customerId: 'c1',
          status: 'REQUESTED',
          discoveryStartedAt: T0,
          suggestUpCount: 0,
          wishPrice: 1500,
        })),
        update: jest.fn(),
      },
    };
    await expect(
      applySuggestUp(prisma, null, 'j1', 'c1', 50, t(30)),
    ).rejects.toThrow(/too-early/);
    expect(prisma.journey.update).not.toHaveBeenCalled();
  });

  it('treats null wishPrice as 0 baseline', async () => {
    const prisma: any = {
      journey: {
        findUnique: jest.fn(async () => ({
          id: 'j1',
          customerId: 'c1',
          status: 'REQUESTED',
          discoveryStartedAt: T0,
          suggestUpCount: 0,
          wishPrice: null,
        })),
        update: jest.fn(async () => ({ id: 'j1', wishPrice: 50, suggestUpCount: 1 })),
      },
    };
    const result = await applySuggestUp(prisma, null, 'j1', 'c1', 50, t(70));
    expect(result.newWishPrice).toBe(50);
  });
});

describe('getSuggestUpStatus', () => {
  it('at 30s → no amounts, next reveal at 60s', () => {
    const s = getSuggestUpStatus(
      { discoveryStartedAt: T0, suggestUpCount: 0 },
      t(30),
    );
    expect(s.availableAmounts).toEqual([]);
    expect(s.nextAmountAvailableAt).toEqual(t(60));
  });

  it('at 70s → [50], next reveal at 120s', () => {
    const s = getSuggestUpStatus(
      { discoveryStartedAt: T0, suggestUpCount: 0 },
      t(70),
    );
    expect(s.availableAmounts).toEqual([50]);
    expect(s.nextAmountAvailableAt).toEqual(t(120));
  });

  it('at 130s → [50, 100], no further reveal', () => {
    const s = getSuggestUpStatus(
      { discoveryStartedAt: T0, suggestUpCount: 1 },
      t(130),
    );
    expect(s.availableAmounts).toEqual([50, 100]);
    expect(s.nextAmountAvailableAt).toBeNull();
    expect(s.alreadyTakenCount).toBe(1);
  });

  it('null discoveryStartedAt → empty status', () => {
    const s = getSuggestUpStatus(
      { discoveryStartedAt: null, suggestUpCount: 0 },
      t(130),
    );
    expect(s.availableAmounts).toEqual([]);
    expect(s.nextAmountAvailableAt).toBeNull();
  });
});
