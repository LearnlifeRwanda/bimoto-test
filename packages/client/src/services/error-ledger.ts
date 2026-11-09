// SERVICES/ERROR-LEDGER.TS
//
// BLACKBOX G2 — the phone's black box. Every error the app hits is
// written here; nothing is ever transmitted from here. Sending is a
// separate, explicit user action on the Diagnostics screen.
//
// Why it exists: docs/error-ledger.md §1 measured what a crash used to
// leave behind on a live stack — nothing, in all five error classes. A
// render crash produced good recovery UI and a console line that died
// with the WebView; a lost promise produced no user signal and no
// app-side console line at all. Every Kigali field report therefore
// arrived as a description from memory.
//
// Four rules this module keeps, in order of importance:
//
//   1. It cannot hurt the app. Every entry point is wrapped; a ledger
//      that cannot initialise (private-mode storage, quota, a corrupt
//      ring) turns itself OFF and the app runs exactly as it did
//      before. There is no path from a recording failure to a user-
//      visible failure. Recording NEVER alters recovery behaviour —
//      the boundaries call in and are handed back control unchanged.
//
//   2. Redaction happens at WRITE time, not send time. A token or a
//      request body is not filtered on the way out; it is
//      unrepresentable in the stored entry. A stolen phone's ledger
//      must contain no secret, and "we strip it before upload" is not
//      that promise.
//
//   3. It is bounded. A ring buffer with a hard entry cap AND a hard
//      byte cap, because an error loop can produce thousands of
//      entries a minute and the device's storage is not ours to fill.
//
//   4. It stores facts, not prose. Timestamp, build id, route, kind,
//      status, path — the same discipline the Diagnostics screen
//      already keeps (DiagnosticsPage.tsx:12). The only free text is
//      the error's OWN message and stack, redacted and truncated.
//
// Storage: localStorage, one key, deliberately NOT Dexie/IndexedDB
// (which is this codebase's precedent for cached data — see
// services/map-cache.ts). Three reasons:
//
//   - IndexedDB writes are asynchronous. This module is written to
//     from componentDidCatch, window.onerror and unhandledrejection —
//     the exact moments the page may be about to be destroyed. An
//     async write can be lost precisely in the case the ledger exists
//     for; localStorage.setItem returns when the value is durable.
//   - Dexie here holds bulk payload (a ~40 MB PMTiles archive, cached
//     journeys). The ledger is a few KB of short strings, well inside
//     localStorage's budget, and the repo already keeps small durable
//     facts there (hooks/usePreferences.ts, PickupVerifyCard).
//   - ErrorBoundary's level-2 recovery clears Dexie tables. Keeping the
//     ledger out of Dexie means "clear cached data and retry" can never
//     erase the record of the crash that prompted it.

import { create } from 'zustand';

declare const __APP_BUILD_SHA__: string;

const STORAGE_KEY = 'bimoto-error-ledger-v1';

/** Most recent entries kept. Older ones fall off the ring. */
export const MAX_ENTRIES = 50;
/** Hard ceiling on the serialised ring, in real UTF-8 bytes. Entries are
 *  dropped oldest-first until the payload fits, whatever the entry count
 *  says — one enormous stack must not spend the whole budget. */
export const MAX_TOTAL_BYTES = 64 * 1024;
/** Per-entry text caps, applied AFTER redaction so truncation can never
 *  bisect a secret and leave half of it behind. */
export const MAX_MESSAGE_CHARS = 300;
export const MAX_STACK_CHARS = 1000;

export type ErrorLedgerKind =
  /** Render crash caught by the top-level ErrorBoundary (main.tsx). */
  | 'render'
  /** Render crash caught by ScreenErrorBoundary (one routed screen). */
  | 'screen-render'
  /** A promise rejected with nobody listening. */
  | 'unhandled-rejection'
  /** window.onerror — a throw outside the React tree. */
  | 'window-error'
  /** An apiFetch request that never got a response. */
  | 'api-network'
  /** An apiFetch request the server answered with 5xx. */
  | 'api-server'
  /** bootstrap() itself failed before React rendered (main.tsx). */
  | 'boot'
  /** FLIGHT-RECORDER G3 — written at boot when the PREVIOUS session left
   *  its marker open: the process died while the app was in front of the
   *  user, so no handler here ever ran (services/session-marker.ts). The
   *  only entry kind that describes a moment this module could not see. */
  | 'abnormal-end'
  /** GHOST-TRACE G2 — an offline GPS point could not be written to the
   *  Dexie buffer, or had no signed-in user to be stamped with. The
   *  point is gone either way; this is the only trace that it was.
   *  GROUNDSKEEPER G3 — also covers a position watch that never started
   *  (useEmergencyFollowStream): the same loss, all of it at once. */
  | 'gps-buffer';

export interface ErrorLedgerEntry {
  /** ms since epoch. */
  t: number;
  /** App build sha (__APP_BUILD_SHA__), 'unknown' when unbuilt. */
  build: string;
  /** location.pathname — never the query string (see redact()). */
  route: string;
  kind: ErrorLedgerKind;
  /** The error's own message, redacted then truncated. */
  message: string;
  /** The error's own stack, redacted then truncated. Absent when none. */
  stack?: string;
  /** API entries only: HTTP status. */
  status?: number;
  /** API entries only: request method. */
  method?: string;
  /** API entries only: request path, query string stripped. */
  path?: string;
}

/** What a caller may hand to recordError. Note what is NOT here: there
 *  is no field for a request body, a response body, a form value or a
 *  header. A body is not filtered out of an entry — it has nowhere to
 *  go in one. */
export interface ErrorLedgerInput {
  kind: ErrorLedgerKind;
  message: unknown;
  stack?: unknown;
  status?: number;
  method?: string;
  path?: string;
}

// ------------------------------------------------------------- redaction

const REDACTED = '[redacted]';

/**
 * Patterns whose match is removed from the text before it is stored.
 * Deliberately over-broad: a false positive costs one unreadable word
 * in a diagnostic message, a false negative puts a live credential on a
 * phone that can be stolen.
 */
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  // Authorization: Bearer <token>  /  "Bearer eyJ..."
  [/\bbearer\s+[\w.\-+/=]+/gi, `Bearer ${REDACTED}`],
  // A JWT anywhere, header.payload.signature.
  [/\beyJ[\w-]{4,}\.[\w-]{4,}\.[\w-]{4,}/g, REDACTED],
  // token=..., "accessToken": "...", refresh_token: '...', otp=123456,
  // password=..., secret=..., apiKey=..., code=...
  [
    /(["']?\b(?:access[_-]?token|refresh[_-]?token|id[_-]?token|token|auth(?:orization)?|api[_-]?key|apikey|secret|password|passwd|pwd|otp|pin|code)\b["']?\s*[:=]\s*)(["']?)[^\s,;&"'}\])]+\2/gi,
    `$1${REDACTED}`,
  ],
  // A long opaque run — hex/base64url of 32+ chars is never prose.
  [/\b[A-Za-z0-9_-]{32,}\b/g, REDACTED],
];

/** International and local Rwandan phone shapes: +250781234567,
 *  0781234567, 250 781 234 567. Masked (not dropped) — the shape is
 *  sometimes the diagnostic, the digits never are. Separators exclude
 *  newlines and tabs so a match can never span two stack frames. */
const PHONE_PATTERN = /\+?\d[\d ().-]{7,}\d/g;

function maskPhone(match: string): string {
  const digits = match.replace(/\D/g, '');
  if (digits.length < 9) return match; // not a phone; leave it (ids, sizes)
  const tail = digits.slice(-3);
  return `${match.trimStart().startsWith('+') ? '+' : ''}${'*'.repeat(
    Math.max(0, digits.length - 3),
  )}${tail}`;
}

/**
 * Strip every query string and fragment from anything URL-shaped. A
 * query string is where ids, tokens and search terms live, and none of
 * them are ours to keep.
 */
function stripQueryStrings(text: string): string {
  return text.replace(/([a-z][\w+.-]*:\/\/[^\s"'<>]+|\/[^\s"'<>?#]*)([?#][^\s"'<>]*)/gi, '$1');
}

/**
 * The single redaction pass. Runs on every string that reaches the
 * ledger — message, stack, route and path alike — BEFORE truncation and
 * BEFORE persistence.
 */
export function redact(text: string): string {
  let out = stripQueryStrings(text);
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  out = out.replace(PHONE_PATTERN, maskPhone);
  return out;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

/** How much text redaction is allowed to scan, as a multiple of the
 *  field's cap. A real stack is a few thousand characters; a runaway one
 *  can be megabytes, and scanning megabytes on the crash path is a cost
 *  the recorder has no right to impose. Anything the pre-cut leaves
 *  dangling is still redacted by the same pass afterwards. */
const REDACTION_INPUT_MULTIPLE = 8;

/** Redact, then truncate — never the other way round, so a cut can
 *  never bisect a secret and leave half of it in the entry. */
function clean(value: unknown, max: number): string {
  const raw =
    typeof value === 'string'
      ? value
      : value instanceof Error
        ? value.message
        : value === undefined || value === null
          ? ''
          : String(value);
  return truncate(redact(raw.slice(0, max * REDACTION_INPUT_MULTIPLE)), max);
}

// --------------------------------------------------------------- storage

let storageProbed = false;
let storageHandle: Storage | null = null;

/** localStorage, or null where it is unavailable (private mode, a
 *  WebView with storage disabled). Same shape as usePreferences'
 *  safeLocalStorage, but probed on first use rather than at module load:
 *  merely importing the ledger must do nothing at all. */
function safeStorage(): Storage | null {
  if (storageProbed) return storageHandle;
  storageProbed = true;
  try {
    if (typeof window === 'undefined') return (storageHandle = null);
    const ls = window.localStorage;
    // Access alone can throw; a probe write proves it is usable.
    const probe = '__bimoto_ledger_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    storageHandle = ls;
  } catch {
    storageHandle = null;
  }
  return storageHandle;
}

/** False disables every write and read. Set when initialisation fails
 *  for any reason: a ledger that cannot work is a ledger that is off,
 *  never an app that cannot boot. */
let enabled = false;

interface ErrorLedgerState {
  entries: ErrorLedgerEntry[];
}

/** Newest LAST, matching the on-disk order; the UI reverses for display. */
export const useErrorLedgerStore = create<ErrorLedgerState>(() => ({ entries: [] }));

function readStored(): ErrorLedgerEntry[] {
  const ls = safeStorage();
  if (!ls) return [];
  try {
    const raw = ls.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // A ring written by a future/older build is data we do not
    // understand; keep only rows that still look like entries, and put
    // their text back through the caps. A ring that was hand-edited or
    // written by another build does not get to spend more of this
    // device's storage than a ring we wrote ourselves.
    return parsed
      .filter(
        (e): e is ErrorLedgerEntry =>
          !!e &&
          typeof e === 'object' &&
          typeof (e as ErrorLedgerEntry).t === 'number' &&
          typeof (e as ErrorLedgerEntry).kind === 'string' &&
          typeof (e as ErrorLedgerEntry).message === 'string',
      )
      .map((e) => {
        const capped: ErrorLedgerEntry = {
          ...e,
          message: clean(e.message, MAX_MESSAGE_CHARS),
        };
        if (typeof e.stack === 'string') capped.stack = clean(e.stack, MAX_STACK_CHARS);
        return capped;
      });
  } catch {
    return [];
  }
}

const encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;

/** Real UTF-8 byte length; falls back to code units where TextEncoder is
 *  absent (a floor, not a lie — the caps stay conservative either way). */
export function byteLength(text: string): number {
  return encoder ? encoder.encode(text).length : text.length;
}

/**
 * Persist the ring under BOTH caps. Entry count first, then bytes:
 * drop oldest until the serialised payload fits, so one enormous stack
 * can never push the ledger past its budget.
 */
function persist(entries: ErrorLedgerEntry[]): ErrorLedgerEntry[] {
  let kept = entries.slice(-MAX_ENTRIES);
  let serialised = JSON.stringify(kept);
  while (kept.length > 1 && byteLength(serialised) > MAX_TOTAL_BYTES) {
    kept = kept.slice(1);
    serialised = JSON.stringify(kept);
  }
  try {
    safeStorage()?.setItem(STORAGE_KEY, serialised);
  } catch {
    // Quota or a locked store. The in-memory ring stays correct for
    // this session; the next write tries again. Never throws outward.
  }
  return kept;
}

// ------------------------------------------------------------ write path

function currentBuild(): string {
  try {
    return typeof __APP_BUILD_SHA__ === 'string' && __APP_BUILD_SHA__
      ? __APP_BUILD_SHA__
      : 'unknown';
  } catch {
    return 'unknown';
  }
}

function currentRoute(): string {
  try {
    // pathname only — the query string is stripped, not stored.
    return typeof window !== 'undefined' ? window.location.pathname : '';
  } catch {
    return '';
  }
}

/**
 * THE one write path. Every source — both error boundaries,
 * window.onerror, unhandledrejection, apiFetch — comes through here,
 * and nothing else writes to storage.
 *
 * Returns the stored entry, or null when the ledger is off or the write
 * was swallowed. Callers ignore the return value: recording is an
 * observation, never a step in anyone's control flow.
 */
/** How long a window-error and a boundary catch can be apart and still
 *  be the same throw. One animation frame's worth is generous. */
const SUPERSEDE_WINDOW_MS = 1000;

/**
 * One thrown render error must leave ONE line, not three.
 *
 * A development React build re-throws every error a boundary catches
 * through a synthetic event so DevTools can see it, which fires
 * window.onerror first — twice, because React re-renders once before
 * giving up. Our global handler records those before componentDidCatch
 * ever runs. So when a boundary reports, it supersedes the raw
 * window-error rows for the same message: the boundary knows what kind
 * of crash it was, the global handler does not.
 *
 * Scoped as narrowly as it can be — same message, within a second, and
 * only ever dropping 'window-error' rows in favour of a render row.
 */
/**
 * Browsers hand window.onerror a message with a prefix the thrower never
 * wrote — "Uncaught Error: ...", "Uncaught TypeError: ...", "Uncaught
 * (in promise) ..." — while componentDidCatch gets error.message clean.
 * Comparing the two means removing it.
 */
function stripUncaught(message: string): string {
  if (!/^Uncaught[\s:]/.test(message)) return message;
  let rest = message.slice('Uncaught'.length);
  if (rest.startsWith(' (in promise)')) rest = rest.slice(' (in promise)'.length);
  // An optional "Error:" / "TypeError:" / "DOMException:" label.
  rest = rest.replace(/^\s*[\w$]*(?:Error|Exception)\s*:/, '');
  return rest.replace(/^[\s:]+/, '');
}

/** Is this window-error message the same throw the boundary just caught? */
export function sameThrow(windowMessage: string, boundaryMessage: string): boolean {
  const stripped = stripUncaught(windowMessage);
  if (stripped === boundaryMessage) return true;
  // Both were capped at MAX_MESSAGE_CHARS, and the prefix above eats
  // into that cap, so a long message is truncated at two different
  // offsets. When the shorter one is a truncation, a shared head is
  // enough.
  const [shorter, longer] =
    stripped.length < boundaryMessage.length
      ? [stripped, boundaryMessage]
      : [boundaryMessage, stripped];
  if (!shorter.endsWith('…')) return false;
  return longer.startsWith(shorter.slice(0, -1));
}

function supersedeWindowErrors(
  entries: ErrorLedgerEntry[],
  message: string,
  now: number,
): ErrorLedgerEntry[] {
  return entries.filter(
    (e) =>
      !(
        e.kind === 'window-error' &&
        now - e.t <= SUPERSEDE_WINDOW_MS &&
        sameThrow(e.message, message)
      ),
  );
}

export function recordError(input: ErrorLedgerInput): ErrorLedgerEntry | null {
  if (!enabled) return null;
  try {
    const entry: ErrorLedgerEntry = {
      t: Date.now(),
      build: currentBuild(),
      route: redact(currentRoute()),
      kind: input.kind,
      message: clean(input.message, MAX_MESSAGE_CHARS) || 'unknown error',
    };
    const stack = clean(input.stack, MAX_STACK_CHARS);
    if (stack) entry.stack = stack;
    if (typeof input.status === 'number') entry.status = input.status;
    if (typeof input.method === 'string') entry.method = input.method.toUpperCase().slice(0, 8);
    if (typeof input.path === 'string') entry.path = truncate(redact(input.path), 200);

    const existing =
      entry.kind === 'render' || entry.kind === 'screen-render'
        ? supersedeWindowErrors(useErrorLedgerStore.getState().entries, entry.message, entry.t)
        : useErrorLedgerStore.getState().entries;
    const next = persist([...existing, entry]);
    useErrorLedgerStore.setState({ entries: next });
    return entry;
  } catch {
    // A recorder that throws is worse than no recorder.
    return null;
  }
}

// ----------------------------------------------------------------- reads

/** Newest first — the order the Diagnostics screen shows them in. */
export function readErrorLedger(): ErrorLedgerEntry[] {
  return [...useErrorLedgerStore.getState().entries].reverse();
}

export function errorLedgerCount(): number {
  return useErrorLedgerStore.getState().entries.length;
}

/** True when the ledger initialised and is recording. */
export function isErrorLedgerEnabled(): boolean {
  return enabled;
}

export function clearErrorLedger(): void {
  try {
    safeStorage()?.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do; the in-memory clear below still takes effect.
  }
  useErrorLedgerStore.setState({ entries: [] });
}

// ------------------------------------------------------- global handlers

let handlersInstalled = false;

function onWindowError(event: ErrorEvent): void {
  // The 'error' event also fires for failed <img>/<script> loads, which
  // carry neither a message nor an Error. Those are not app faults and
  // would only crowd the ring.
  if (!event.message && !event.error) return;
  recordError({
    kind: 'window-error',
    message: event.message || event.error?.message,
    stack: event.error?.stack,
  });
}

function onUnhandledRejection(event: PromiseRejectionEvent): void {
  const reason: unknown = event.reason;
  recordError({
    kind: 'unhandled-rejection',
    message: reason instanceof Error ? reason.message : reason,
    stack: reason instanceof Error ? reason.stack : undefined,
  });
}

/**
 * Load the persisted ring and start recording. Idempotent, and safe to
 * call from anywhere: on ANY failure the ledger stays off and the
 * caller is none the wiser.
 *
 * Called once from main.tsx's bootstrap, before anything else, so a
 * failure during boot is itself recordable.
 */
export function initErrorLedger(): boolean {
  try {
    if (!safeStorage()) {
      enabled = false;
      return false;
    }
    useErrorLedgerStore.setState({ entries: readStored().slice(-MAX_ENTRIES) });
    if (!handlersInstalled && typeof window !== 'undefined') {
      window.addEventListener('error', onWindowError);
      window.addEventListener('unhandledrejection', onUnhandledRejection);
      handlersInstalled = true;
    }
    enabled = true;
    return true;
  } catch {
    enabled = false;
    return false;
  }
}

/** Test-only: rewind module + store state between cases. */
export function _resetErrorLedgerForTests(): void {
  if (handlersInstalled && typeof window !== 'undefined') {
    window.removeEventListener('error', onWindowError);
    window.removeEventListener('unhandledrejection', onUnhandledRejection);
    handlersInstalled = false;
  }
  enabled = false;
  try {
    safeStorage()?.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  // Re-probe on the next init so a test can simulate storage being
  // unavailable at start-up.
  storageProbed = false;
  storageHandle = null;
  useErrorLedgerStore.setState({ entries: [] });
}
