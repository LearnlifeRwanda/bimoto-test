// MONEY-PIN G6 (client) — the pad, the block, the prompt-on-401.

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';
import { i18n } from './setup';

vi.mock('../lib/api', () => ({
  apiFetch: vi.fn(),
  isConnectivityError: () => false,
}));

import { apiFetch } from '../lib/api';
import { PinPad } from '../components/money/PinPad';
import { MoneyPinPanel } from '../components/money/MoneyPinPanel';
import { withMoneyStepUp } from '../lib/money-pin';
import { useMoneyPinStore } from '../stores/money-pin.store';

const fetchMock = apiFetch as unknown as ReturnType<typeof vi.fn>;

// MONEY-PIN placement correction — the prompt is owned by the component
// that asked for it, so opening one in a test names an owner. The panel
// under test reads the store directly, so any stable string serves.
const OWNER = 'test-owner';

function jsonRes(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    clone() {
      return this as unknown as Response;
    },
  } as unknown as Response;
}

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage('en');
  useMoneyPinStore.setState({
    prompt: 'closed',
    owner: null,
    lockedUntil: null,
    stepUpOpen: false,
    resolver: null,
    waiters: [],
  });
});

describe('PinPad', () => {
  test('renders one dot per digit and fills them as keys are pressed', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <PinPad value="" onChange={onChange} length={4} ariaLabel="pad" />,
    );
    expect(screen.getAllByTestId(/^pin-dot-/)).toHaveLength(4);
    expect(screen.getByTestId('pin-dot-0')).toHaveAttribute('data-filled', 'false');

    fireEvent.click(screen.getByTestId('pin-key-7'));
    expect(onChange).toHaveBeenCalledWith('7');

    rerender(<PinPad value="7" onChange={onChange} length={4} ariaLabel="pad" />);
    expect(screen.getByTestId('pin-dot-0')).toHaveAttribute('data-filled', 'true');
  });

  test('NEVER renders the digits themselves', () => {
    render(<PinPad value="1234" onChange={vi.fn()} length={4} ariaLabel="pad" />);
    const dots = screen.getByTestId('pin-dots');
    // The keypad has "1".."9" as key labels; the DOTS must not echo the value.
    expect(dots.textContent).toBe('');
  });

  test('fires onComplete at the last digit', () => {
    const onComplete = vi.fn();
    render(
      <PinPad value="123" onChange={vi.fn()} length={4} onComplete={onComplete} ariaLabel="pad" />,
    );
    fireEvent.click(screen.getByTestId('pin-key-4'));
    expect(onComplete).toHaveBeenCalledWith('1234');
  });

  test('caps at length and stops accepting input', () => {
    const onChange = vi.fn();
    render(<PinPad value="1234" onChange={onChange} length={4} ariaLabel="pad" />);
    fireEvent.click(screen.getByTestId('pin-key-5'));
    expect(onChange).not.toHaveBeenCalled();
  });

  test('maxLength lets a code run longer than the dots shown', () => {
    // The app lock draws MIN_LENGTH dots but accepts more, so the dots
    // never tell a shoulder-surfer how many digits to guess.
    const onChange = vi.fn();
    render(
      <PinPad value="123456" onChange={onChange} length={6} maxLength={12} ariaLabel="pad" />,
    );
    fireEvent.click(screen.getByTestId('pin-key-7'));
    expect(onChange).toHaveBeenCalledWith('1234567');
  });

  test('backspace removes the last digit', () => {
    const onChange = vi.fn();
    render(<PinPad value="12" onChange={onChange} length={4} ariaLabel="pad" />);
    fireEvent.click(screen.getByTestId('pin-backspace'));
    expect(onChange).toHaveBeenCalledWith('1');
  });
});

describe('withMoneyStepUp', () => {
  test('a call that is never gated does not touch the prompt', async () => {
    const call = vi.fn().mockResolvedValue(jsonRes(200, { pendingAmount: 100 }));
    const res = await withMoneyStepUp(call, OWNER);
    expect(res.status).toBe(200);
    expect(call).toHaveBeenCalledTimes(1);
    expect(useMoneyPinStore.getState().prompt).toBe('closed');
  });

  test('a step-up 401 opens the verify prompt and retries once on success', async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce(
        jsonRes(401, { error: { code: 'MONEY_STEP_UP_REQUIRED' } }),
      )
      .mockResolvedValueOnce(jsonRes(200, { pendingAmount: 100 }));

    const promise = withMoneyStepUp(call, OWNER);
    await waitFor(() => expect(useMoneyPinStore.getState().prompt).toBe('verify'));

    act(() => useMoneyPinStore.getState().settle(true));
    const res = await promise;

    expect(res.status).toBe(200);
    expect(call).toHaveBeenCalledTimes(2);
  });

  test('a 428 opens the ENROLMENT prompt — the lazy block', async () => {
    const call = vi
      .fn()
      .mockResolvedValue(jsonRes(428, { error: { code: 'MONEY_PIN_ENROLLMENT_REQUIRED' } }));
    const promise = withMoneyStepUp(call, OWNER);
    await waitFor(() => expect(useMoneyPinStore.getState().prompt).toBe('enroll'));
    act(() => useMoneyPinStore.getState().settle(false));
    await promise;
  });

  test('a 423 opens the LOCKED prompt and carries the lift time', async () => {
    const until = new Date(Date.now() + 600_000).toISOString();
    const call = vi
      .fn()
      .mockResolvedValue(
        jsonRes(423, { error: { code: 'MONEY_PIN_LOCKED' }, lockedUntil: until }),
      );
    const promise = withMoneyStepUp(call, OWNER);
    await waitFor(() => expect(useMoneyPinStore.getState().lockedUntil).toBe(until));
    act(() => useMoneyPinStore.getState().settle(false));
    await promise;
  });

  test('giving up returns the ORIGINAL rejection, not a fabricated success', async () => {
    const call = vi
      .fn()
      .mockResolvedValue(jsonRes(401, { error: { code: 'MONEY_STEP_UP_REQUIRED' } }));
    const promise = withMoneyStepUp(call, OWNER);
    await waitFor(() => expect(useMoneyPinStore.getState().prompt).toBe('verify'));

    act(() => useMoneyPinStore.getState().settle(false));
    const res = await promise;

    expect(res.status).toBe(401);
    // No retry — the caller renders its ordinary error path.
    expect(call).toHaveBeenCalledTimes(1);
  });

  test('retries EXACTLY once — a second refusal is not another prompt', async () => {
    const call = vi
      .fn()
      .mockResolvedValue(jsonRes(401, { error: { code: 'MONEY_STEP_UP_REQUIRED' } }));
    const promise = withMoneyStepUp(call, OWNER);
    await waitFor(() => expect(useMoneyPinStore.getState().prompt).toBe('verify'));
    act(() => useMoneyPinStore.getState().settle(true));
    await promise;
    expect(call).toHaveBeenCalledTimes(2);
    // A driver must always be able to get out of a prompt.
    expect(useMoneyPinStore.getState().prompt).toBe('closed');
  });

  test('an ordinary 401 that is NOT a money gate passes straight through', async () => {
    const call = vi.fn().mockResolvedValue(jsonRes(401, { error: { code: 'UNAUTHORIZED' } }));
    const res = await withMoneyStepUp(call, OWNER);
    expect(res.status).toBe(401);
    expect(call).toHaveBeenCalledTimes(1);
    expect(useMoneyPinStore.getState().prompt).toBe('closed');
  });
});

describe('MoneyPinPanel', () => {
  test('renders nothing at all until a money call is refused', () => {
    const { container } = render(<MoneyPinPanel />);
    expect(container).toBeEmptyDOMElement();
  });

  test('the enrolment screen blocks, and "not now" answers the caller false', async () => {
    let settled: boolean | null = null;
    act(() => {
      useMoneyPinStore.getState().open('enroll', (ok) => {
        settled = ok;
      }, OWNER);
    });
    render(<MoneyPinPanel />);
    expect(screen.getByTestId('money-pin-gate')).toHaveAttribute('data-prompt', 'enroll');

    fireEvent.click(screen.getByTestId('money-pin-dismiss'));
    await waitFor(() => expect(settled).toBe(false));
  });

  test('a correct PIN verifies and settles true', async () => {
    fetchMock.mockResolvedValue(jsonRes(200, { ok: true }));
    let settled: boolean | null = null;
    act(() => {
      useMoneyPinStore.getState().open('verify', (ok) => {
        settled = ok;
      }, OWNER);
    });
    render(<MoneyPinPanel />);

    for (const d of ['1', '2', '3', '4']) {
      fireEvent.click(screen.getByTestId(`money-pin-key-${d}`));
    }
    await waitFor(() => expect(settled).toBe(true));

    // The PIN went up in the body, and only there.
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ pin: '1234' });
  });

  test('a wrong PIN shows the error and does NOT settle', async () => {
    fetchMock.mockResolvedValue(jsonRes(401, { error: { code: 'MONEY_PIN_INVALID' } }));
    let settled: boolean | null = null;
    act(() => {
      useMoneyPinStore.getState().open('verify', (ok) => {
        settled = ok;
      }, OWNER);
    });
    render(<MoneyPinPanel />);
    for (const d of ['9', '9', '9', '9']) {
      fireEvent.click(screen.getByTestId(`money-pin-key-${d}`));
    }
    await waitFor(() => expect(screen.getByTestId('money-pin-error')).toBeInTheDocument());
    expect(settled).toBeNull();
  });

  test('the PIN is never written to any storage', async () => {
    fetchMock.mockResolvedValue(jsonRes(200, { ok: true }));
    act(() => {
      useMoneyPinStore.getState().open('verify', () => {}, OWNER);
    });
    render(<MoneyPinPanel />);
    for (const d of ['1', '2', '3', '4']) {
      fireEvent.click(screen.getByTestId(`money-pin-key-${d}`));
    }
    await waitFor(() => expect(useMoneyPinStore.getState().prompt).toBe('closed'));

    // invariant §3, asserted rather than assumed.
    expect(JSON.stringify(useMoneyPinStore.getState())).not.toContain('1234');
    expect(JSON.stringify(localStorage)).not.toContain('1234');
  });

  test('the reset screen explains the 24-hour wait instead of just closing', async () => {
    const activatesAt = new Date(Date.now() + 24 * 3600_000).toISOString();
    fetchMock
      .mockResolvedValueOnce(jsonRes(200, { otpId: 'o1' }))
      .mockResolvedValueOnce(jsonRes(200, { activatesAt }));

    act(() => {
      useMoneyPinStore.getState().open('verify', () => {}, OWNER);
    });
    render(<MoneyPinPanel />);

    fireEvent.click(screen.getByTestId('money-pin-forgot'));
    await waitFor(() =>
      expect(screen.getByTestId('money-pin-reset-sms')).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByTestId('money-pin-reset-sms'), {
      target: { value: '123456' },
    });
    for (const d of ['7', '7', '7', '7']) {
      fireEvent.click(screen.getByTestId(`money-pin-reset-key-${d}`));
    }
    for (const d of ['7', '7', '7', '7']) {
      fireEvent.click(screen.getByTestId(`money-pin-reset-key-${d}`));
    }

    // The screen stays open on success: a driver who does not learn about
    // the wait here learns it tomorrow at a money screen.
    await waitFor(() =>
      expect(screen.getByTestId('money-pin-reset-explain')).toBeInTheDocument(),
    );
  });
});

describe('two money calls racing on one screen', () => {
  // AccountPage mounts the earnings card AND the payout-preference
  // section, both on useDriverPayout, both fetching on mount. This is the
  // ordinary case, not an edge one.
  test('the second refusal joins the pad in flight — it does not open a second', async () => {
    const first = vi.fn();
    const second = vi.fn();

    act(() => {
      useMoneyPinStore.getState().open('enroll', first, 'owner-a');
      useMoneyPinStore.getState().open('enroll', second, 'owner-b');
    });

    // One pad, owned by whoever asked first.
    expect(useMoneyPinStore.getState().owner).toBe('owner-a');
    expect(useMoneyPinStore.getState().waiters).toHaveLength(1);
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
  });

  test('answering the pad answers BOTH, so both sections fill', async () => {
    const first = vi.fn();
    const second = vi.fn();
    act(() => {
      useMoneyPinStore.getState().open('enroll', first, 'owner-a');
      useMoneyPinStore.getState().open('enroll', second, 'owner-b');
      useMoneyPinStore.getState().settle(true);
    });

    // The loser is NOT told "no". An earlier version answered it false,
    // so its component gave up and stayed empty even after the driver
    // had enrolled.
    expect(first).toHaveBeenCalledWith(true);
    expect(second).toHaveBeenCalledWith(true);
    expect(useMoneyPinStore.getState().waiters).toHaveLength(0);
  });

  test('a declined pad declines the waiters too', () => {
    const first = vi.fn();
    const second = vi.fn();
    act(() => {
      useMoneyPinStore.getState().open('enroll', first, 'owner-a');
      useMoneyPinStore.getState().open('enroll', second, 'owner-b');
      useMoneyPinStore.getState().settle(false);
    });
    expect(first).toHaveBeenCalledWith(false);
    expect(second).toHaveBeenCalledWith(false);
  });
});
