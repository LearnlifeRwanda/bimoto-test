import { create } from 'zustand';

// MONEY-PIN G3 — the prompt's state, and the promise the caller is
// waiting on.
//
// THE PROBLEM THIS SOLVES. A money call can 401 from anywhere: the
// earnings card refreshing, the account page loading, a driver tapping
// "pay me now". Every one of those wants the same thing — put a PIN pad
// in front of the user, wait, then retry the call that failed. Threading
// that through each caller would put the prompt logic in four places and
// let them fight over who owns the modal.
//
// So the prompt is ONE component mounted once at the app root, and this
// store is the channel. A caller opens it and awaits a promise; the
// component resolves that promise when the user succeeds or gives up.
//
// WHAT IS NOT IN HERE, EVER: the PIN. This store holds which screen is
// showing and one resolver function. The digits live in the pad
// component's own useState for as long as it takes to POST them, and go
// when it unmounts. Nothing about the PIN is persisted, cached, or put
// anywhere a later render could read it — that is invariant §3, and a
// store is exactly the kind of convenient place it would otherwise leak
// into.
//
// WHERE IT RENDERS — corrected after the E2E caught the first version.
//
// The prompt used to be ONE component mounted at the app root, rendering
// a full-screen overlay. That was wrong, and the cross-locale-chat E2E
// proved it: `DriverEarningsCard` sits on the driver DASHBOARD, its
// summary fetch runs on mount, and a driver with no PIN therefore got
// `fixed inset-0 z-[60] bg-white` over his whole working screen —
// "subtree intercepts pointer events" on the feed, the online toggle and
// every navigation. That is precisely what ruling D25's second half
// forbids.
//
// So the prompt now renders INSIDE the money component that asked for
// it, and `owner` is what makes that possible: the store still holds ONE
// prompt (two pads on one screen would be worse than one in the wrong
// place), but only the instance whose call was refused renders it.
//
// The client's ONLY cached fact is `stepUpOpen`: "our last verify
// succeeded, so don't prompt again yet". It is a hint for avoiding a
// double prompt and NOTHING is authorised by it — the server holds the
// real session and re-checks every request. A client that lies to itself
// here gets a 401 and prompts.

export type MoneyPinPrompt =
  | 'closed'
  /** No PIN yet — the lazy-enrolment block. Cannot be dismissed into the surface. */
  | 'enroll'
  /** A PIN exists; prove it. */
  | 'verify'
  /** Attempt budget spent. Nothing to type. */
  | 'locked'
  /** The SMS-code + new-PIN + 24-hour-explanation flow. */
  | 'reset';

interface MoneyPinState {
  prompt: MoneyPinPrompt;
  /**
   * Which `useDriverPayout` instance's call was refused. Its panel — and
   * only its panel — renders the prompt. `useId()` supplies the value, so
   * two hooks on one page (AccountPage mounts both the earnings card and
   * the preference section) cannot both draw a pad.
   */
  owner: string | null;
  /** When the lockout lifts, for the locked screen's copy. */
  lockedUntil: string | null;
  /**
   * Client-side hint only. See the note above: this authorises nothing.
   */
  stepUpOpen: boolean;
  /** Resolves the awaiting caller: true = proven, false = user gave up. */
  resolver: ((ok: boolean) => void) | null;
  /**
   * Callers refused while a pad was already up. They render no pad of
   * their own and are answered with the owner's outcome.
   */
  waiters: Array<(ok: boolean) => void>;

  open: (
    prompt: MoneyPinPrompt,
    resolver: (ok: boolean) => void,
    owner: string,
    lockedUntil?: string | null,
  ) => void;
  setPrompt: (prompt: MoneyPinPrompt, lockedUntil?: string | null) => void;
  /** Closes the prompt and answers the waiting caller exactly once. */
  settle: (ok: boolean) => void;
  markStepUpOpen: () => void;
  clearStepUp: () => void;
}

export const useMoneyPinStore = create<MoneyPinState>((set, get) => ({
  prompt: 'closed',
  owner: null,
  lockedUntil: null,
  stepUpOpen: false,
  resolver: null,
  waiters: [],

  open: (prompt, resolver, owner, lockedUntil = null) => {
    // A SECOND CALLER JOINS THE PROMPT IN FLIGHT; it does not replace it.
    //
    // Two money calls racing on one screen is ordinary — AccountPage
    // mounts the earnings card AND the payout-preference section, and
    // both fetch on mount. Two PIN pads would be absurd, so the first
    // refusal owns the pad. But the loser must not simply be told "no"
    // either: the earlier version answered it `false`, so its component
    // gave up, rendered nothing, and stayed empty even after the driver
    // had enrolled.
    //
    // So the loser WAITS. When the pad is answered, every waiter is
    // answered with the same outcome and retries its own call — one pad,
    // and both sections populated behind it.
    if (get().resolver) {
      set({ waiters: [...get().waiters, resolver] });
      return;
    }
    set({ prompt, resolver, owner, lockedUntil });
  },

  setPrompt: (prompt, lockedUntil = null) => set({ prompt, lockedUntil }),

  settle: (ok) => {
    const { resolver, waiters } = get();
    set({ prompt: 'closed', resolver: null, owner: null, lockedUntil: null, waiters: [] });
    resolver?.(ok);
    // Everyone who queued behind the pad gets the same answer and retries
    // their own call, so a screen with two money sections fills both.
    for (const w of waiters) w(ok);
  },

  markStepUpOpen: () => set({ stepUpOpen: true }),
  clearStepUp: () => set({ stepUpOpen: false }),
}));
