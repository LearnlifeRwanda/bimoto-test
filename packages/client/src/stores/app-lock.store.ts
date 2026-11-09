import { create } from 'zustand';

// APP-LOCK G4 — is the app covered right now, and why.
//
// THE PINNED INVARIANT lives here as much as in the LockScreen: no action
// taken from the lock screen changes what is reachable behind it. The
// only transition out of `locked` is `unlock()`, and the ONLY caller of
// unlock() is a successful device-local code verify. Raising SOS, dialling
// 112, backgrounding, rotating — none of them touch this. There is
// deliberately no `bypass()`, no `unlockForEmergency()`, no boolean an
// emergency path could set. A function that does not exist cannot be
// called by mistake in six months.

interface AppLockState {
  /** Whether a code is set on this device. Loaded once at boot. */
  armed: boolean;
  /** Whether the app is covered right now. */
  locked: boolean;
  /** Set when the app goes to background, read when it comes back. */
  backgroundedAt: number | null;
  /** Cold-start / background-timeout minutes. 0 = cold start only. */
  timeoutMinutes: number;

  setArmed: (armed: boolean, timeoutMinutes?: number) => void;
  lock: () => void;
  /** The one way out. Called only after a code verified. */
  unlock: () => void;
  setBackgroundedAt: (at: number | null) => void;
}

export const useAppLockStore = create<AppLockState>((set) => ({
  armed: false,
  // Starts LOCKED-if-armed rather than unlocked-until-proven. The boot
  // sequence reads storage and calls setArmed, which decides; until that
  // resolves nothing renders a route anyway. Defaulting the other way
  // would flash a real screen before the lock landed.
  locked: false,
  backgroundedAt: null,
  timeoutMinutes: 0,

  setArmed: (armed, timeoutMinutes = 0) =>
    set({ armed, timeoutMinutes, locked: armed }),

  lock: () => set({ locked: true }),
  // The one way out. Nav state is NOT cleared here: `history.replaceState`
  // does not notify React Router (only popstate does), so doing it from
  // the store changed the URL bar while leaving the deep-linked route
  // rendered — the lock would have become a delay rather than a door.
  // AppLockGate watches this flag and navigates through the router
  // instead, which is the only thing that actually re-renders.
  unlock: () => set({ locked: false, backgroundedAt: null }),
  setBackgroundedAt: (at) => set({ backgroundedAt: at }),
}));
