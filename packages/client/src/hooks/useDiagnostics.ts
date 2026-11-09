import { useCallback, useEffect, useState } from 'react';
import { useAuthStore } from '../stores/auth.store';
import { useDiagnosticsStore } from '../stores/diagnostics.store';
import { apiFetch } from '../lib/api';

// MATCH-CLOSE G4 — the fact-gathering behind the diagnostics screen, so
// the page itself stays a plain list of rows.
//
// Two of the facts have to be asked for (the server's build, and the
// online status as the SERVER reports it — not as the app believes it);
// the rest are recorded as they happen in diagnostics.store.

declare const __APP_BUILD_SHA__: string;

export interface DiagnosticsSnapshot {
  appBuild: string;
  serverBuild: string | null;
  buildsMatch: boolean | null;
  role: string | null;
  serverOnline: boolean | null;
  lastFeedViewAs: string | null;
  lastFeedStatus: number | null;
  lastFeedAt: number | null;
  lastLocationLat: number | null;
  lastLocationLng: number | null;
  lastLocationAt: number | null;
  socketConnected: boolean;
  /** LIVE-WIRE G2 — 'websocket', 'polling', or null when disconnected. */
  socketTransport: string | null;
  isRefreshing: boolean;
  refresh: () => void;
}

export function useDiagnostics(): DiagnosticsSnapshot {
  const role = useAuthStore((s) => s.user?.role ?? null);
  const recorded = useDiagnosticsStore();

  const [serverBuild, setServerBuild] = useState<string | null>(null);
  const [serverOnline, setServerOnline] = useState<boolean | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    // DEADWOOD G5 — the probes are CANCELLED on unmount, not merely
    // ignored.
    //
    // The `cancelled` flag below guards the setState calls, but it left
    // the requests themselves in flight: a Diagnostics screen that had
    // been closed went on asking the network for two answers nobody was
    // waiting for. When one of those failed, apiFetch recorded an
    // 'api-network' entry in the error ledger — a global side effect,
    // outside any component's lifetime. That is what made the
    // Clear-log test order-dependent: the previous test's abandoned
    // /api/users/me landed in the NEXT test's freshly-initialised
    // ledger, one entry after it had just been cleared.
    //
    // apiFetch already treats an AbortError as "we cancelled it, say
    // nothing about the network" (lib/api.ts, MAP-TRUTH G5), so passing
    // the signal is the whole fix: an abandoned probe now records
    // nothing, reports nothing, and moves no connection state.
    const controller = new AbortController();
    let cancelled = false;
    const load = async () => {
      setIsRefreshing(true);
      try {
        const healthRes = await apiFetch('/api/health', {
          credentials: 'include',
          signal: controller.signal,
        });
        const health = healthRes.ok ? await healthRes.json() : null;
        if (!cancelled) setServerBuild(health?.version ?? null);
      } catch {
        if (!cancelled) setServerBuild(null);
      }
      try {
        // The server's own view of this driver's online column — the
        // one supply broadcasts read. A driver who believes they are
        // online while this says false is the whole "motaris cannot see
        // incoming requests" failure, visible in one row.
        const meRes = await apiFetch('/api/users/me', {
          credentials: 'include',
          signal: controller.signal,
        });
        const me = meRes.ok ? await meRes.json() : null;
        const user = me?.user ?? me;
        if (!cancelled) setServerOnline(user?.driverProfile?.isOnline ?? null);
      } catch {
        if (!cancelled) setServerOnline(null);
      }
      if (!cancelled) setIsRefreshing(false);
    };
    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [reloadKey]);

  const appBuild =
    typeof __APP_BUILD_SHA__ === 'string' && __APP_BUILD_SHA__ ? __APP_BUILD_SHA__ : 'unknown';

  return {
    appBuild,
    serverBuild,
    buildsMatch:
      serverBuild === null || appBuild === 'unknown' || serverBuild === 'unknown'
        ? null
        : serverBuild === appBuild,
    role,
    serverOnline,
    lastFeedViewAs: recorded.lastFeedViewAs,
    lastFeedStatus: recorded.lastFeedStatus,
    lastFeedAt: recorded.lastFeedAt,
    lastLocationLat: recorded.lastLocationLat,
    lastLocationLng: recorded.lastLocationLng,
    lastLocationAt: recorded.lastLocationAt,
    socketConnected: recorded.socketConnected,
    socketTransport: recorded.socketTransport,
    isRefreshing,
    refresh,
  };
}
