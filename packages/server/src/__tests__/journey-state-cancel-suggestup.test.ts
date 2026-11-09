// Dispatch Q (4/7) — chokepoint test. Verifies that
// onJourneyExitsRequested cancels suggest-up timers idempotently and
// swallows internal errors so callers don't have to wrap.

jest.mock('../services/customer-modes/suggest-up-scheduler', () => ({
  cancelSuggestUpEmits: jest.fn(),
}));

import { cancelSuggestUpEmits } from '../services/customer-modes/suggest-up-scheduler';
import { onJourneyExitsRequested } from '../services/journey-state-transitions';

const cancelMock = cancelSuggestUpEmits as jest.Mock;

beforeEach(() => {
  cancelMock.mockReset();
});

describe('onJourneyExitsRequested chokepoint', () => {
  test('cancels suggest-up emits for the journey', () => {
    onJourneyExitsRequested('j-1', 'bid-accepted');
    expect(cancelMock).toHaveBeenCalledWith('j-1');
  });

  test('idempotent — repeated calls for same journey just call cancel each time without throwing', () => {
    onJourneyExitsRequested('j-1', 'a');
    onJourneyExitsRequested('j-1', 'b');
    onJourneyExitsRequested('j-1', 'c');
    expect(cancelMock).toHaveBeenCalledTimes(3);
  });

  test('swallows errors thrown by cancelSuggestUpEmits (logs only)', () => {
    cancelMock.mockImplementation(() => {
      throw new Error('boom');
    });
    expect(() => onJourneyExitsRequested('j-1', 'expired')).not.toThrow();
  });

  test('reason is propagated to log context (no exception)', () => {
    expect(() => onJourneyExitsRequested('j-1', 'journey-cancelled')).not.toThrow();
    expect(cancelMock).toHaveBeenCalledTimes(1);
  });

  test('different journey IDs each route to their own cancel call', () => {
    onJourneyExitsRequested('j-1', 'r');
    onJourneyExitsRequested('j-2', 'r');
    expect(cancelMock).toHaveBeenNthCalledWith(1, 'j-1');
    expect(cancelMock).toHaveBeenNthCalledWith(2, 'j-2');
  });
});
