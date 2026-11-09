// FLIGHT-RECORDER G2 — the failures fly home on their own.
//
// BLACKBOX shipped the recorder and a button. The button works, and
// almost nobody presses it: a motari who hits a bug is mid-ride, and the
// Diagnostics screen is three taps away from a problem they are busy
// having. So the ledger filled up on the phone and the team in Kigali
// still learned about crashes by hearing about them.
//
// This module closes that gap without breaking the promise the button
// made. Four rules, in order:
//
//   1. Consent decides, and consent is real. The signup consent says
//      plainly that diagnostics are sent, Settings can turn it off, and
//      OFF means OFF: this module makes no request of any kind. Not a
//      smaller one, not a delayed one. (The Send report button keeps
//      working either way — an explicit tap is its own consent.)
//   2. It sends exactly what the button sends. Same serializer
//      (error-report-payload.ts), same bytes, same preview on the
//      Diagnostics screen. There is no second, richer payload that the
//      user never sees.
//   3. It cannot hurt the app. Every path is wrapped and every failure
//      is silent; nothing here is awaited by anything that renders. A
//      failed upload changes nothing on the device — the entries stay,
//      unmarked, and the next attempt tries again.
//   4. It is bounded, on both ends. A per-session entry cap, and a
//      minimum interval between uploads that keeps this under the
//      route's own 5-per-hour rate limit with a slot left over for the
//      button. A recorder that spends a user's data budget is a bug.
//
// Storage is localStorage, one key, for the same reason the ledger's is
// (error-ledger.ts:38): ErrorBoundary's level-2 recovery clears Dexie,
// and "which entries did we already send" must survive exactly the
// crash-and-recover cycle that produced the entries. This is NOT the
// journey outbox (lib/outbox.ts) and shares nothing with it: that queue
// carries a user's booking and must never be crowded out by diagnostics.

import { useAuthStore } from '../stores/auth.store';
import { apiFetch } from '../lib/api';
import { onConnectivityChange, getIsOnline } from '../sync/connectivity';
import { prefs, PREF_KEYS } from '../hooks/usePreferences';
import { readErrorLedger, type ErrorLedgerEntry } from './error-ledger';
import { buildErrorReport } from './error-report-payload';

const STATE_KEY = 'bimoto-diag-upload-v1';

/** Most entries this module will upload in one app session. The ring
 *  itself holds 50, so this bites only when a session records more than
 *  fifty distinct faults — at which point the fifty-first tells the team
 *  less than the fact that there were fifty. */
export const MAX_SESSION_ENTRIES = 50;

/** Floor between two automatic uploads. The route allows 5 reports per
 *  hour per user; four leaves the user's own Send report button a slot
 *  even in the worst session. */
export const MIN_UPLOAD_INTERVAL_MS = 15 * 60_000;

/** How long after boot the first attempt runs. Long enough that login,
 *  the first feed and the map tiles have the radio to themselves. */
export const BOOT_DELAY_MS = 8_000;

interface UploadState {
  /** Newest entry timestamp already accepted by the server. */
  lastSentT: number;
  /** Fingerprints uploaded whose t === lastSentT, so a second entry
   *  recorded in the same millisecond is not mistaken for a duplicate. */
  lastSentFps: string[];
  /** Epoch ms of the last 2xx. Gates MIN_UPLOAD_INTERVAL_MS. */
  lastUploadAt: number;
}

const EMPTY_STATE: UploadState = { lastSentT: 0, lastSentFps: [], lastUploadAt: 0 };

function safeStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readState(): UploadState {
  try {
    const raw = safeStorage()?.getItem(STATE_KEY);
    if (!raw) return { ...EMPTY_STATE };
    const parsed = JSON.parse(raw) as Partial<UploadState> | null;
    if (!parsed || typeof parsed !== 'object') return { ...EMPTY_STATE };
    return {
      lastSentT: typeof parsed.lastSentT === 'number' ? parsed.lastSentT : 0,
      lastSentFps: Array.isArray(parsed.lastSentFps)
        ? parsed.lastSentFps.filter((f): f is string => typeof f === 'string')
        : [],
      lastUploadAt: typeof parsed.lastUploadAt === 'number' ? parsed.lastUploadAt : 0,
    };
  } catch {
    return { ...EMPTY_STATE };
  }
}

function writeState(state: UploadState): void {
  try {
    safeStorage()?.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    // Quota or a locked store. Worst case the same bundle is sent twice;
    // the server stores two rows with the same fingerprint, which is a
    // duplicate row, not a lost one. Never throws outward.
  }
}

// ------------------------------------------------------------- consent

/**
 * Is the consented background upload ON?
 *
 * Default ON for the pilot: the consent screen states it at signup and
 * Settings turns it off, so an unset preference is a user who was told
 * and did not object — not a user who was never asked. Only the explicit
 * string 'false' is OFF, so a corrupt or half-written value fails
 * towards the documented default rather than towards silence.
 */
export function isDiagnosticsUploadEnabled(): boolean {
  try {
    return prefs.getSync(PREF_KEYS.diagnosticsUpload) !== 'false';
  } catch {
    return false;
  }
}

// -------------------------------------------------------------- upload

/** Entries the server has not already accepted, newest first. */
export function unsentEntries(entries: ErrorLedgerEntry[], state: UploadState): ErrorLedgerEntry[] {
  return entries.filter((e) => {
    if (e.t > state.lastSentT) return true;
    // Same millisecond as the high-water mark: only unsent if this exact
    // fault was not part of that batch.
    if (e.t < state.lastSentT) return false;
    return !state.lastSentFps.includes(
      buildErrorReport([e]).entries[0]?.fp ?? '',
    );
  });
}

let sessionEntriesSent = 0;
let inFlight = false;

/**
 * One attempt. Returns what happened, for tests and for nobody else —
 * no caller branches on it.
 */
export async function flushDiagnostics(
  opts: { force?: boolean } = {},
): Promise<'sent' | 'skipped' | 'failed'> {
  if (inFlight) return 'skipped';
  try {
    if (!isDiagnosticsUploadEnabled()) return 'skipped';
    // A report belongs to a person; there is nobody to attribute an
    // anonymous one to, and the route would answer 401.
    if (!useAuthStore.getState().isAuthenticated) return 'skipped';
    if (!getIsOnline()) return 'skipped';
    if (sessionEntriesSent >= MAX_SESSION_ENTRIES) return 'skipped';

    const state = readState();
    if (!opts.force && Date.now() - state.lastUploadAt < MIN_UPLOAD_INTERVAL_MS) return 'skipped';

    const pending = unsentEntries(readErrorLedger(), state);
    if (pending.length === 0) return 'skipped';

    const budget = MAX_SESSION_ENTRIES - sessionEntriesSent;
    // Newest first, so trimming to the budget keeps what matters most.
    const batch = pending.slice(0, budget);
    const body = buildErrorReport(batch);
    if (body.entries.length === 0) return 'skipped';

    inFlight = true;
    // Written out in full rather than via a constant so the wiring audit
    // can see the call site (scripts/wiring-audit).
    const res = await apiFetch('/api/diagnostics/error-report', {
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify(body),
    });
    // Only a 2xx marks anything as sent. A 429, a 401 or a 500 leaves
    // the high-water mark exactly where it was, and the same entries go
    // again next time — which is the whole point of not deleting them.
    if (!res.ok) return 'failed';

    const newest = batch.reduce((max, e) => (e.t > max ? e.t : max), state.lastSentT);
    writeState({
      lastSentT: newest,
      lastSentFps: body.entries.filter((e) => e.t === newest).map((e) => e.fp),
      lastUploadAt: Date.now(),
    });
    sessionEntriesSent += batch.length;
    return 'sent';
  } catch {
    // Offline, unreachable, storage gone. Nothing was marked; nothing
    // was lost.
    return 'failed';
  } finally {
    inFlight = false;
  }
}

// ------------------------------------------------------------ lifecycle

let started = false;
let unsubscribe: (() => void) | null = null;
let bootTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Start the batcher: one delayed attempt after boot, and one on every
 * transition back to online.
 *
 * Called from main.tsx AFTER the app has rendered, deliberately: this
 * module imports the auth store and the api layer, and the ledger's
 * init-first ordering (main.tsx:10) exists precisely so nothing heavier
 * front-runs it. Idempotent, and every path is wrapped.
 */
export function startDiagnosticsUpload(): void {
  if (started) return;
  started = true;
  try {
    bootTimer = setTimeout(() => {
      void flushDiagnostics({ force: true });
    }, BOOT_DELAY_MS);
    unsubscribe = onConnectivityChange((online) => {
      if (online) void flushDiagnostics();
    });
  } catch {
    // No background upload this session. The Send report button is
    // unaffected, which is the path that existed before this module.
  }
}

/** Test-only: rewind module state between cases. */
export function _resetDiagnosticsUploadForTests(): void {
  if (bootTimer) clearTimeout(bootTimer);
  bootTimer = null;
  unsubscribe?.();
  unsubscribe = null;
  started = false;
  inFlight = false;
  sessionEntriesSent = 0;
  try {
    safeStorage()?.removeItem(STATE_KEY);
  } catch {
    // ignore
  }
}
