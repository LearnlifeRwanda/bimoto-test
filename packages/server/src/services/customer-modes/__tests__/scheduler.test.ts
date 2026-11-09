// SERVICES/CUSTOMER-MODES/__TESTS__/SCHEDULER.TEST.TS
//
// Dispatch K3 group 6 — verifies the in-process setTimeout scheduler
// fires Socket.io emits at T1=60s and T2=120s, that cancellation
// clears pending timers, and that each emit re-checks journey status
// so a journey that went MATCHED in between never gets a stale emit.

jest.useFakeTimers();

import {
  scheduleSuggestUpEmits,
  cancelSuggestUpEmits,
  _resetForTests,
  _hasScheduledTimersForTests,
} from '../suggest-up-scheduler';

beforeEach(() => {
  _resetForTests();
  jest.clearAllTimers();
});

afterAll(() => {
  jest.useRealTimers();
});

function makeIo() {
  const emit = jest.fn();
  const to = jest.fn(() => ({ emit }));
  return { io: { to } as any, emit, to };
}

function makePrisma(status: string = 'REQUESTED', suggestUpCount: number = 0) {
  return {
    journey: {
      findUnique: jest.fn(async () => ({ status, suggestUpCount })),
    },
  } as any;
}

describe('suggest-up-scheduler', () => {
  it('fires T1 emit at 60s and T2 emit at 120s', async () => {
    const { io, emit, to } = makeIo();
    const prisma = makePrisma('REQUESTED');

    scheduleSuggestUpEmits('j1', 'c1', io, prisma);

    expect(emit).not.toHaveBeenCalled();

    // Advance to T1 (60s).
    jest.advanceTimersByTime(60_000);
    // Allow the awaited findUnique + emit chain to flush.
    await Promise.resolve();
    await Promise.resolve();

    expect(to).toHaveBeenCalledWith('user:c1');
    expect(emit).toHaveBeenCalledWith(
      'suggest-up:available',
      expect.objectContaining({
        journeyId: 'j1',
        amounts: [50],
      }),
    );

    // Advance to T2 (120s total).
    jest.advanceTimersByTime(60_000);
    await Promise.resolve();
    await Promise.resolve();

    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenLastCalledWith(
      'suggest-up:available',
      expect.objectContaining({
        journeyId: 'j1',
        amounts: [50, 100],
      }),
    );
  });

  it('cancelSuggestUpEmits clears both pending timers', async () => {
    const { io, emit } = makeIo();
    const prisma = makePrisma('REQUESTED');

    scheduleSuggestUpEmits('j1', 'c1', io, prisma);
    expect(_hasScheduledTimersForTests('j1')).toBe(true);

    cancelSuggestUpEmits('j1');
    expect(_hasScheduledTimersForTests('j1')).toBe(false);

    jest.advanceTimersByTime(180_000);
    await Promise.resolve();
    await Promise.resolve();

    expect(emit).not.toHaveBeenCalled();
  });

  it('emit guard: journey already MATCHED when timer fires → no emit', async () => {
    const { io, emit } = makeIo();
    const prisma = makePrisma('MATCHED');

    scheduleSuggestUpEmits('j1', 'c1', io, prisma);
    jest.advanceTimersByTime(60_000);
    await Promise.resolve();
    await Promise.resolve();

    expect(emit).not.toHaveBeenCalled();
  });

  it('re-scheduling the same journeyId replaces (does not duplicate) timers', async () => {
    const { io, emit } = makeIo();
    const prisma = makePrisma('REQUESTED');

    scheduleSuggestUpEmits('j1', 'c1', io, prisma);
    scheduleSuggestUpEmits('j1', 'c1', io, prisma);

    jest.advanceTimersByTime(60_000);
    await Promise.resolve();
    await Promise.resolve();

    // Only ONE T1 emit even though we scheduled twice.
    expect(emit).toHaveBeenCalledTimes(1);
  });
});
