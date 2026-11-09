import { create } from 'zustand';
import { prefs } from '../hooks/usePreferences';

// ── NOTIFY G1 — the toast system grows up ─────────────────────────
//
// Toasts used to be ONE message: showToast() overwrote whatever was on
// screen, and the Toast component cleared it after a fixed 3 seconds.
// That is the right shape for form feedback ("Saved", "Language
// changed") and the wrong shape for news. D9 (founder + team, 20 Aug)
// ruled that a notification must last ~15 seconds and that a second
// must not erase the first — a motari whose bid is accepted while a
// nearby request is still on screen has to see both.
//
// So a toast now carries a CLASS:
//
//   'transient'    — 3 s, the pre-existing behaviour. Every existing
//                    call site is one of these, byte-identically: the
//                    third argument defaults to it.
//   'notification' — NOTIFICATION_TOAST_MS, for anything that arrived
//                    from the server rather than from a tap.
//
// and the store holds a STACK rather than a single slot. `toastMessage`
// and `toastType` survive as the head of that stack, so every reader
// written against the old shape keeps working and keeps meaning what it
// meant. They are derived by headOf() and are never set on their own.
//
// NOT PERSISTED — D9 ruled no inbox. This array lives in memory, dies
// with the tab, and has no Dexie table behind it. A test pins that
// (NotifyNoInbox.test.ts).

export type ToastType = 'success' | 'error' | 'info';
export type ToastClass = 'transient' | 'notification';

export interface Toast {
  id: number;
  message: string;
  type: ToastType;
  toastClass: ToastClass;
}

/** D9's ~15 seconds, in one place. */
export const NOTIFICATION_TOAST_MS = 15_000;
/** The pre-queue lifetime, unchanged for form feedback. */
export const TRANSIENT_TOAST_MS = 3_000;

export const TOAST_DURATIONS: Record<ToastClass, number> = {
  transient: TRANSIENT_TOAST_MS,
  notification: NOTIFICATION_TOAST_MS,
};

/**
 * How many toasts are RENDERED at once. Four notification-class toasts
 * already fill a small phone screen, so the rest collapse into a single
 * "+N more" line rather than pushing the newest one off the top.
 */
export const MAX_VISIBLE_TOASTS = 4;

/**
 * How many the stack HOLDS. Purely a memory bound — a socket storm must
 * not grow an array without limit — and deliberately well above the
 * visible cap so the "+N more" count is a real number for any burst a
 * person could actually receive.
 */
export const MAX_TOASTS = 12;

// Monotonic, module-scoped: ids must not collide across a clear, and
// nothing outside this module needs to mint one.
let toastSeq = 0;
function nextToastId(): number {
  toastSeq += 1;
  return toastSeq;
}

/** The legacy single-toast fields, derived from the stack's head. */
function headOf(toasts: Toast[]): Pick<UIState, 'toastMessage' | 'toastType'> {
  const head = toasts[0];
  return {
    toastMessage: head?.message ?? null,
    toastType: head?.type ?? null,
  };
}

interface UIState {
  /**
   * MAP-TRUTH G5 — READ THIS BEFORE USING IT.
   *
   * This is "can we usefully talk to the Bimoto API right now", NOT "does
   * this phone have a network". App.tsx sets it from
   * `connection === 'online'`, so it is false for BOTH a device with no
   * signal and a device whose signal is perfect while our API does not
   * answer. That is the right question for the offline-first data paths
   * that own it — whether to queue a write, whether to read from cache,
   * whether to spend a request on geocoding.
   *
   * It is the WRONG question for anything about the device, the user's
   * connection, or a third-party service. Two things went wrong by
   * reading it as though it meant "offline":
   *
   *   - MapCanvas hid the map with it, so a Bimoto API blip blanked a
   *     map whose tiles come from OpenStreetMap (fixed in G2 — the map
   *     asks useNetworkStatus, the Capacitor device signal);
   *   - SyncIndicator printed "Offline" with it, on working connections
   *     (fixed in G5 — it reads useConnectionState and says "offline"
   *     only for 'offline').
   *
   * For a device-network answer use useNetworkStatus (@capacitor/network).
   * For a user-facing connectivity message use useConnectionState, which
   * distinguishes 'offline' from 'unreachable'.
   */
  isOnline: boolean;
  isSyncing: boolean;
  language: string;
  modalOpen: string | null;
  /**
   * NOTIFY G1 — the live toast stack, newest FIRST.
   *
   * `toastMessage` / `toastType` remain as the head of that stack so
   * every existing reader keeps working unchanged; they are derived,
   * never set independently. See the module note below the interface.
   */
  toasts: Toast[];
  toastMessage: string | null;
  toastType: ToastType | null;
  // SOCKET-FIX G4 — set when the server pushes account-frozen; renders
  // the blocking AccountFrozenNotice until the user acknowledges (which
  // logs them out via the auth store's existing logout path).
  accountFrozen: boolean;
  setAccountFrozen: (frozen: boolean) => void;
  setOnline: (online: boolean) => void;
  setSyncing: (syncing: boolean) => void;
  setLanguage: (lang: string) => void;
  openModal: (id: string) => void;
  closeModal: () => void;
  /**
   * Unchanged two-argument call — every existing call site keeps its
   * byte-identical behaviour and its 3-second transient lifetime.
   * A third argument opts a toast into the notification class.
   */
  showToast: (message: string, type: ToastType, toastClass?: ToastClass) => void;
  /** Dismiss ONE toast by id. */
  dismissToast: (id: number) => void;
  /** Clear the whole stack (the pre-queue `hideToast` contract). */
  hideToast: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  isSyncing: false,
  language: prefs.getSync('bimoto-lang') || 'rw',
  modalOpen: null,
  toasts: [],
  toastMessage: null,
  toastType: null,
  accountFrozen: false,
  setAccountFrozen: (accountFrozen) => set({ accountFrozen }),
  setOnline: (isOnline) => set({ isOnline }),
  setSyncing: (isSyncing) => set({ isSyncing }),
  setLanguage: (language) => {
    void prefs.set('bimoto-lang', language);
    set({ language });
  },
  openModal: (modalOpen) => set({ modalOpen }),
  closeModal: () => set({ modalOpen: null }),
  showToast: (message, type, toastClass = 'transient') =>
    set((state) => {
      const toast: Toast = { id: nextToastId(), message, type, toastClass };
      // Newest first. Trimmed only at the memory bound; the VISIBLE cap
      // is Toast's business, and what it hides it counts.
      const toasts = [toast, ...state.toasts].slice(0, MAX_TOASTS);
      return { toasts, ...headOf(toasts) };
    }),
  dismissToast: (id) =>
    set((state) => {
      const toasts = state.toasts.filter((toast) => toast.id !== id);
      return { toasts, ...headOf(toasts) };
    }),
  hideToast: () => set({ toasts: [], toastMessage: null, toastType: null }),
}));
