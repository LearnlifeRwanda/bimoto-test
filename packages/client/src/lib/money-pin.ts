// LIB/MONEY-PIN.TS
//
// MONEY-PIN G3 — the client's half of the money gate: the API calls, and
// the retry wrapper that turns a step-up 401 into a PIN pad and then into
// a second attempt.
//
// THE PIN'S ONLY JOURNEY is up, in a request body, over TLS. It is not
// stored, not cached, not logged, not put in a store, not written to
// secure storage and not kept in a closure past the request. Every
// function here takes it as an argument and forgets it on return. That is
// invariant §3 and this file is where it would be easiest to break.

import { apiFetch } from './api';
import { useMoneyPinStore, MoneyPinPrompt } from '../stores/money-pin.store';

export type MoneyPinState = 'NOT_SET' | 'SET' | 'PENDING_RESET';

export interface MoneyPinStatus {
  state: MoneyPinState;
  pendingActivatesAt: string | null;
  lockedUntil: string | null;
}

export async function fetchMoneyPinStatus(): Promise<MoneyPinStatus | null> {
  const res = await apiFetch('/api/users/me/money-pin', { credentials: 'include' });
  if (!res.ok) return null;
  return res.json();
}

export interface PinCallResult {
  ok: boolean;
  /** The server's error code, when it rejected. Never a message with a PIN in it. */
  code?: string;
  lockedUntil?: string;
  activatedPendingReset?: boolean;
  cancelledPendingReset?: boolean;
}

async function postPin(path: string, body: Record<string, unknown>): Promise<PinCallResult> {
  const res = await apiFetch(path, {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      code: data?.error?.code,
      lockedUntil: data?.lockedUntil,
    };
  }
  return {
    ok: true,
    activatedPendingReset: data?.activatedPendingReset,
    cancelledPendingReset: data?.cancelledPendingReset,
  };
}

export function setMoneyPin(pin: string): Promise<PinCallResult> {
  return postPin('/api/users/me/money-pin', { pin });
}

export function verifyMoneyPin(pin: string): Promise<PinCallResult> {
  return postPin('/api/users/me/money-pin/verify', { pin });
}

export function changeMoneyPin(currentPin: string, newPin: string): Promise<PinCallResult> {
  return postPin('/api/users/me/money-pin/change', { currentPin, newPin });
}

export async function requestMoneyPinReset(): Promise<{ otpId: string } | null> {
  const res = await apiFetch('/api/users/me/money-pin/reset/request', {
    method: 'POST',
    credentials: 'include',
  });
  if (!res.ok) return null;
  return res.json();
}

export async function confirmMoneyPinReset(
  otpId: string,
  code: string,
  newPin: string,
): Promise<{ activatesAt: string } | null> {
  const res = await apiFetch('/api/users/me/money-pin/reset/confirm', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify({ otpId, code, newPin }),
  });
  if (!res.ok) return null;
  return res.json();
}

/** The three server codes that mean "the money gate stopped you". */
const GATE_CODES: Record<string, MoneyPinPrompt> = {
  MONEY_PIN_ENROLLMENT_REQUIRED: 'enroll',
  MONEY_STEP_UP_REQUIRED: 'verify',
  MONEY_PIN_LOCKED: 'locked',
};

/**
 * Reads a Response WITHOUT consuming it for the caller.
 *
 * A Response body can be read once. `clone()` before reading means the
 * caller's own `res.json()` still works whether or not this matched —
 * getting that wrong would break every non-gate error path in the app.
 */
export async function readGateCode(
  res: Response,
): Promise<{ prompt: MoneyPinPrompt; lockedUntil?: string } | null> {
  if (res.status !== 401 && res.status !== 423 && res.status !== 428) return null;
  try {
    const data = await res.clone().json();
    const prompt = GATE_CODES[data?.error?.code];
    if (!prompt) return null;
    return { prompt, lockedUntil: data?.lockedUntil };
  } catch {
    return null;
  }
}

/**
 * Runs a money call; if the money gate turns it away, puts the right
 * prompt in front of the user and runs it EXACTLY ONCE more.
 *
 * One retry, not a loop. If the second attempt is also refused, something
 * is wrong that another PIN pad will not fix, and a component that keeps
 * re-prompting is a component a driver cannot get out of.
 *
 * The caller's shape is untouched: it gets a Response either way, and a
 * call that was never gated never notices this wrapper exists.
 *
 * `owner` names which component's panel should draw the prompt. It is
 * required rather than optional because the alternative — a default that
 * renders somewhere central — is exactly the bug the E2E caught: a
 * full-screen pad over a driver's working screen.
 */
export async function withMoneyStepUp(
  call: () => Promise<Response>,
  owner: string,
): Promise<Response> {
  const first = await call();
  const gate = await readGateCode(first);
  if (!gate) return first;

  useMoneyPinStore.getState().clearStepUp();

  const proven = await new Promise<boolean>((resolve) => {
    useMoneyPinStore.getState().open(gate.prompt, resolve, owner, gate.lockedUntil ?? null);
  });

  // The user cancelled, or the lockout stands. Hand back the original
  // rejection so the caller renders its ordinary error path rather than
  // a success it did not get.
  if (!proven) return first;

  return call();
}
