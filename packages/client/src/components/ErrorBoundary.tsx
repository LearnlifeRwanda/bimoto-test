import React from 'react';
import i18next from 'i18next';
import { recordError } from '../services/error-ledger';

// PUSH-CRASH G2 / PROFILE-RESCUE G3 — top-level boot/render error
// boundary.
//
// Any uncaught exception thrown while rendering the React tree (a JS
// boot failure — the "white screen" class of defect) lands here and
// degrades to a minimal recovery screen instead of a blank WebView.
//
// Recovery ladder (PROFILE-RESCUE G3 — the Kigali field report showed
// the old full location.reload() re-entered the crashed route inside
// the Capacitor WebView and sealed the user in until reinstall):
//   1. Retry — reset boundary state and re-enter at the home route
//      ('/', via history.replaceState) with NO reload, so a crash on
//      one route can never trap the user on that route.
//   2. If the crash recurs right after a retry (a crash loop), offer
//      "clear cached data and retry": drops rebuildable local state —
//      the offline map and locally cached ride data — and NEVER the
//      auth session or unsent queued events.
//   3. Only after a cache-clear retry also failed: a clearly labelled
//      "log out and start over" — an explicit user choice, never a
//      silent side effect.
//
// Scope: this catches JS-layer failures only. A native-thread crash
// (e.g. the Firebase-less PushNotifications.register() throw) kills
// the process before React can react — preventing those is the job of
// the capability gate in usePushNotifications (G1), not this boundary.

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  /** True when the current crash arrived right after a recovery
   * attempt — the "retry lands straight back in the crash" loop. */
  crashLoop: boolean;
  /** True once the level-2 cache clear has been tried this episode. */
  clearedCaches: boolean;
  busy: boolean;
}

// A recovery followed by a crash within this window counts as a crash
// loop (the recovered tree never became usable).
const CRASH_LOOP_WINDOW_MS = 15_000;

// Translate via the i18next singleton rather than react-i18next hooks:
// the boundary must render even when the tree below (providers
// included) is broken, and must not itself throw if it trips before
// i18n has finished initialising — hence the defaultValue fallbacks
// and the defensive catch.
export function tSafe(key: string, fallback: string): string {
  try {
    const value = i18next.t(key, { defaultValue: fallback });
    // Pre-init t() can return undefined instead of throwing.
    return typeof value === 'string' && value ? value : fallback;
  } catch {
    return fallback;
  }
}

const buttonClass =
  'inline-flex items-center justify-center min-h-[44px] px-6 py-2.5 rounded-lg bg-[#1B4F72] text-white font-medium hover:bg-[#164060] transition-colors focus:outline-none focus:ring-2 focus:ring-[#1B4F72] focus:ring-offset-2';
const secondaryButtonClass =
  'inline-flex items-center justify-center min-h-[44px] px-6 py-2.5 rounded-lg bg-white border border-gray-300 text-gray-700 font-medium hover:bg-gray-50 transition-colors focus:outline-none focus:ring-2 focus:ring-[#1B4F72] focus:ring-offset-2';

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = {
    hasError: false,
    crashLoop: false,
    clearedCaches: false,
    busy: false,
  };

  private lastRecoverAt: number | null = null;

  static getDerivedStateFromError(): Partial<ErrorBoundaryState> {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[boot] uncaught render error:', error, info.componentStack);
    // BLACKBOX G2 — observe, never alter. recordError cannot throw and
    // cannot change what happens below; the recovery ladder from here on
    // is byte-identical to what it was before the ledger existed.
    recordError({ kind: 'render', message: error?.message, stack: error?.stack });
    const isLoop =
      this.lastRecoverAt !== null && Date.now() - this.lastRecoverAt < CRASH_LOOP_WINDOW_MS;
    // A fresh crash (not right after a recovery) starts a new episode.
    this.setState((s) => ({
      crashLoop: isLoop,
      clearedCaches: isLoop ? s.clearedCaches : false,
    }));
  }

  /** Reset boundary state and re-enter the app at the home route —
   * in-app, no reload, so we never re-enter the crashed URL. */
  private recover(path = '/'): void {
    this.lastRecoverAt = Date.now();
    try {
      if (window.location.pathname !== path) {
        window.history.replaceState(null, '', path);
      }
    } catch {
      // history unavailable — resetting state alone still remounts.
    }
    this.setState({ hasError: false, busy: false });
  }

  handleRetry = (): void => {
    this.recover();
  };

  // Level 2 — drop rebuildable local state: the offline map extract and
  // locally cached ride data (journeys/bids/messages/sync metadata).
  // Deliberately kept: the auth session, preferences, and the
  // syncEvents/gpsBuffer queues (unsent user actions are not
  // rebuildable). Imports are dynamic so the boundary's own module
  // graph stays minimal and boot-order-safe (see main.tsx).
  handleClearCachesAndRetry = async (): Promise<void> => {
    if (this.state.busy) return;
    this.setState({ busy: true });
    try {
      const [{ db }, { deleteAllRegionMaps }] = await Promise.all([
        import('../db/dexie'),
        import('../services/map-cache'),
      ]);
      // Every region, not just Kigali — a rider may hold several, and a
      // clear that left some behind would not be the clear this rung
      // promises.
      await deleteAllRegionMaps();
      await Promise.all([
        db.journeys.clear(),
        db.bids.clear(),
        db.messages.clear(),
        db.syncMeta.clear(),
      ]);
    } catch (err) {
      // Even a failed clear must not dead-end the ladder.
      console.error('[boot] cache clear failed:', err);
    }
    this.setState({ clearedCaches: true });
    this.recover();
  };

  // Level 3 — explicit, labelled session reset. Runs the shared logout
  // sequence (server-side revocation + push deregistration + secure
  // token clear) and lands on /login.
  handleLogoutAndReset = async (): Promise<void> => {
    if (this.state.busy) return;
    this.setState({ busy: true });
    try {
      const { performLogout } = await import('../lib/logout');
      await performLogout();
    } catch (err) {
      console.error('[boot] logout reset failed:', err);
    }
    this.recover('/login');
  };

  override render(): React.ReactNode {
    if (!this.state.hasError) return this.props.children;
    const { crashLoop, clearedCaches, busy } = this.state;
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
        <div className="text-center max-w-sm w-full">
          <p className="text-lg text-gray-600 mb-6">
            {tSafe('errors.boundaryTitle', 'Something went wrong')}
          </p>
          <div className="flex flex-col gap-3 items-stretch">
            <button type="button" onClick={this.handleRetry} disabled={busy} className={buttonClass}>
              {tSafe('errors.boundaryRetry', 'Retry')}
            </button>
            {crashLoop && (
              <>
                <button
                  type="button"
                  onClick={() => void this.handleClearCachesAndRetry()}
                  disabled={busy}
                  className={secondaryButtonClass}
                  data-testid="boundary-clear-caches"
                >
                  {tSafe('errors.boundaryClearRetry', 'Clear cached data and retry')}
                </button>
                <p className="text-sm text-gray-500">
                  {tSafe(
                    'errors.boundaryClearHint',
                    'Keeps you signed in. Removes the downloaded map and locally cached ride data.',
                  )}
                </p>
              </>
            )}
            {crashLoop && clearedCaches && (
              <button
                type="button"
                onClick={() => void this.handleLogoutAndReset()}
                disabled={busy}
                className={secondaryButtonClass}
                data-testid="boundary-logout-reset"
              >
                {tSafe('errors.boundaryLogoutReset', 'Log out and start over')}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
