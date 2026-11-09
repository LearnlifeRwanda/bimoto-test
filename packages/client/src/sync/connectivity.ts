// NET-UX G1 — the ONE connectivity source of truth.
//
// Extends the original boolean online/offline probe into a three-state
// machine consumed by the connection banner, the UI store and the sync
// layer. The Kigali field failure this addresses: a dead tunnel (or a
// stale-DNS phone) left the network "up" but the API unreachable, and
// the app surfaced raw "Failed to fetch" text with no recovery story.
//
// States:
//   'online'      — last signal said the API answers.
//   'offline'     — the device reports no network (navigator.onLine /
//                   @capacitor/network via reportNetworkStatus).
//   'unreachable' — network is up but the API does not answer (fetch
//                   threw in apiFetch, or the health probe failed).
//
// Signals in:
//   - window online/offline events (web) — kept from the original module;
//   - reportNetworkStatus(connected) — @capacitor/network state, mirrored
//     in by useConnectionState (richer than navigator.onLine on native);
//   - reportApiFailure()/reportApiSuccess() — every apiFetch observes its
//     own outcome, so a dead tunnel is detected by real traffic, not
//     only by the probe.
//
// Recovery: while disconnected a health probe is scheduled on the shared
// SYNC_RETRY_BACKOFF_MS ladder (1s → 3s → 10s → 30s, capped at 30s). No
// probe runs while 'online' — this module never polls a healthy server.
// (SyncManager's pre-existing 15s heartbeat is its own sync cadence and
// is unchanged here.) Recovery flips the legacy boolean listeners, which
// is exactly the nudge SyncManager.startMonitoring subscribes to for
// flushing the offline queue.

import { SYNC_RETRY_BACKOFF_MS } from '@bimoto/shared';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export type ConnectionState = 'online' | 'offline' | 'unreachable';

let isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
let state: ConnectionState = isOnline ? 'online' : 'offline';
// Last device-level network signal (defaults to navigator.onLine; kept
// current by reportNetworkStatus so native fetch failures classify
// correctly even where navigator.onLine is unreliable).
let networkUp = isOnline;

const listeners: ((online: boolean) => void)[] = [];
const stateListeners: ((state: ConnectionState) => void)[] = [];

let probeTimer: ReturnType<typeof setTimeout> | null = null;
let probeAttempt = 0;
let nextProbeAt: number | null = null;

export function getIsOnline(): boolean {
  return isOnline;
}

export function getConnectionState(): ConnectionState {
  return state;
}

/** Epoch ms of the next scheduled probe, or null when none is pending. */
export function getNextProbeAt(): number | null {
  return nextProbeAt;
}

export function onConnectivityChange(cb: (online: boolean) => void) {
  listeners.push(cb);
  return () => { const idx = listeners.indexOf(cb); if (idx >= 0) listeners.splice(idx, 1); };
}

export function onConnectionStateChange(cb: (state: ConnectionState) => void) {
  stateListeners.push(cb);
  return () => { const idx = stateListeners.indexOf(cb); if (idx >= 0) stateListeners.splice(idx, 1); };
}

function notify(online: boolean) {
  isOnline = online;
  listeners.forEach(cb => cb(online));
}

function stopProbing() {
  if (probeTimer) {
    clearTimeout(probeTimer);
    probeTimer = null;
  }
  nextProbeAt = null;
}

function scheduleProbe() {
  if (state === 'online' || probeTimer) return;
  const delay = SYNC_RETRY_BACKOFF_MS[Math.min(probeAttempt, SYNC_RETRY_BACKOFF_MS.length - 1)];
  probeAttempt = Math.min(probeAttempt + 1, SYNC_RETRY_BACKOFF_MS.length - 1);
  nextProbeAt = Date.now() + delay;
  probeTimer = setTimeout(() => {
    probeTimer = null;
    nextProbeAt = null;
    void checkConnectivity().finally(() => scheduleProbe());
  }, delay);
}

function setState(next: ConnectionState) {
  if (next === state) return;
  state = next;
  const online = next === 'online';
  if (online) {
    stopProbing();
    probeAttempt = 0;
  }
  if (online !== isOnline) notify(online);
  stateListeners.forEach(cb => cb(next));
  if (!online) scheduleProbe();
}

/**
 * Device-level network signal (from useConnectionState's
 * @capacitor/network / navigator.onLine subscription). Network loss is
 * authoritative for 'offline'; network return triggers an immediate
 * probe rather than an optimistic 'online' — only the API answering
 * proves recovery.
 */
export function reportNetworkStatus(connected: boolean) {
  networkUp = connected;
  if (!connected) {
    setState('offline');
  } else if (state === 'offline') {
    void checkConnectivity();
  }
}

/** apiFetch observed a request that never got a response. */
export function reportApiFailure() {
  setState(networkUp ? 'unreachable' : 'offline');
}

/** apiFetch got any HTTP response — the server is reachable. */
export function reportApiSuccess() {
  setState('online');
}

/** Manual "Try now" from the banner: probe immediately, backoff resets. */
export function retryNow(): Promise<boolean> {
  stopProbing();
  probeAttempt = 0;
  return checkConnectivity().then((online) => {
    if (!online) scheduleProbe();
    return online;
  });
}

export async function checkConnectivity(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/api/health`, { method: 'GET', cache: 'no-store' });
    const online = res.ok;
    setState(online ? 'online' : networkUp ? 'unreachable' : 'offline');
    return online;
  } catch {
    setState(networkUp ? 'unreachable' : 'offline');
    return false;
  }
}

/** Test-only: rewind module state between cases. */
export function _resetConnectivityForTests() {
  stopProbing();
  probeAttempt = 0;
  isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
  networkUp = isOnline;
  state = isOnline ? 'online' : 'offline';
  listeners.length = 0;
  stateListeners.length = 0;
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { networkUp = true; void checkConnectivity(); });
  window.addEventListener('offline', () => { networkUp = false; setState('offline'); });
}
