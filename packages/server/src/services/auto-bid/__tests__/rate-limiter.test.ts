import {
  _resetForTests,
  checkRateLimit,
  recordAutoBid,
} from '../rate-limiter';
import {
  MAX_AUTO_BIDS_PER_DRIVER_PER_HOUR,
  RATE_LIMIT_WINDOW_MINUTES,
} from '../config';

beforeEach(() => {
  _resetForTests();
});

afterAll(() => {
  _resetForTests();
});

describe('auto-bid/rate-limiter', () => {
  it('new driver is allowed with currentCount=0', () => {
    const state = checkRateLimit('d1', new Date('2026-05-05T10:00:00Z'));
    expect(state.allowed).toBe(true);
    expect(state.currentCount).toBe(0);
  });

  it(`rejects the (MAX+1)-th bid inside the window`, () => {
    const t0 = new Date('2026-05-05T10:00:00Z');
    for (let i = 0; i < MAX_AUTO_BIDS_PER_DRIVER_PER_HOUR; i++) {
      // Spread the bids over the first ~15 min so they're all inside the window.
      recordAutoBid('d1', new Date(t0.getTime() + i * 30_000));
    }
    const state = checkRateLimit('d1', new Date(t0.getTime() + 16 * 60 * 1000));
    expect(state.allowed).toBe(false);
    expect(state.currentCount).toBe(MAX_AUTO_BIDS_PER_DRIVER_PER_HOUR);
  });

  it('after the window elapses, the driver is allowed again', () => {
    const t0 = new Date('2026-05-05T10:00:00Z');
    for (let i = 0; i < MAX_AUTO_BIDS_PER_DRIVER_PER_HOUR; i++) {
      recordAutoBid('d1', new Date(t0.getTime() + i * 30_000));
    }
    // Advance well past the rolling window — the last entry was at
    // t0 + (MAX-1)*30s. Move forward enough that even that drops off.
    const farFuture = new Date(
      t0.getTime() +
        (RATE_LIMIT_WINDOW_MINUTES + 30) * 60 * 1000,
    );
    const state = checkRateLimit('d1', farFuture);
    expect(state.allowed).toBe(true);
    expect(state.currentCount).toBe(0);
  });

  it('rolling window: 30 bids in t=0..15min still throttled at t=20min, allowed again at t=61min (smallest-wrongness #3)', () => {
    const t0 = new Date('2026-05-05T10:00:00Z');
    // Fire MAX bids spaced 30s apart, all within the first 15 min.
    for (let i = 0; i < MAX_AUTO_BIDS_PER_DRIVER_PER_HOUR; i++) {
      recordAutoBid('d1', new Date(t0.getTime() + i * 30_000));
    }
    const at20min = new Date(t0.getTime() + 20 * 60 * 1000);
    expect(checkRateLimit('d1', at20min).allowed).toBe(false);

    // At t=61min, the earliest entry (t=0) has aged out of the
    // 60-min window. currentCount drops below MAX, so allowed again.
    const at61min = new Date(t0.getTime() + 61 * 60 * 1000);
    const state = checkRateLimit('d1', at61min);
    expect(state.allowed).toBe(true);
    expect(state.currentCount).toBeLessThan(MAX_AUTO_BIDS_PER_DRIVER_PER_HOUR);
  });

  it('each driver\'s counter is independent', () => {
    const t = new Date('2026-05-05T10:00:00Z');
    for (let i = 0; i < MAX_AUTO_BIDS_PER_DRIVER_PER_HOUR; i++) {
      recordAutoBid('d1', new Date(t.getTime() + i * 30_000));
    }
    expect(checkRateLimit('d1', t).allowed).toBe(false);
    expect(checkRateLimit('d2', t).allowed).toBe(true);
  });

  it('_resetForTests clears all counters', () => {
    const t = new Date('2026-05-05T10:00:00Z');
    for (let i = 0; i < MAX_AUTO_BIDS_PER_DRIVER_PER_HOUR; i++) {
      recordAutoBid('d1', new Date(t.getTime() + i * 30_000));
    }
    _resetForTests();
    expect(checkRateLimit('d1', t).allowed).toBe(true);
    expect(checkRateLimit('d1', t).currentCount).toBe(0);
  });
});
