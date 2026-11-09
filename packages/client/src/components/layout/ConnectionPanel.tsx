// COMPONENTS/LAYOUT/CONNECTION-PANEL.TSX
//
// CHROME-C G2 — the long form of what the header pill says short.
//
// ConnectionBanner used to say this in a 36-48 px strip across every
// screen. The header now carries the state in two words; this is where
// the full sentence, the live countdown and the "Try now" action moved
// to. Nobody sees it unless they ask for it.
//
// The three faces are the banner's, verbatim in meaning:
//   offline      → "You're offline — reconnecting when network returns"
//   unreachable  → "Can't reach Bimoto — retrying…" with a live
//                  countdown to the next backoff probe and a manual
//                  "Try now"
//   online       → connected, nothing to do.
// Connectivity ONLY — JS crashes stay owned by the ErrorBoundary.

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useConnectionState } from '../../hooks/useConnectionState';
import { getNextProbeAt, retryNow } from '../../sync/connectivity';

const COUNTDOWN_TICK_MS = 500;

export const ConnectionPanel: React.FC = () => {
  const { t } = useTranslation();
  const state = useConnectionState();
  const [secondsToRetry, setSecondsToRetry] = useState<number | null>(null);
  const [retrying, setRetrying] = useState(false);

  // Live countdown to the next scheduled probe while unreachable.
  useEffect(() => {
    if (state !== 'unreachable') {
      setSecondsToRetry(null);
      return;
    }
    const tick = () => {
      const at = getNextProbeAt();
      setSecondsToRetry(at === null ? null : Math.max(0, Math.ceil((at - Date.now()) / 1000)));
    };
    tick();
    const interval = setInterval(tick, COUNTDOWN_TICK_MS);
    return () => clearInterval(interval);
  }, [state]);

  const handleTryNow = () => {
    setRetrying(true);
    void retryNow().finally(() => setRetrying(false));
  };

  return (
    <section data-testid="connection-panel">
      {state === 'online' && (
        <p className="text-sm text-gray-700" data-testid="connection-panel-online">
          {t('sync.connected')}
        </p>
      )}

      {state === 'offline' && (
        <p className="text-sm text-gray-700" data-testid="connection-panel-offline">
          {t('connection.offline')}
        </p>
      )}

      {state === 'unreachable' && (
        <div data-testid="connection-panel-unreachable">
          <p className="text-sm text-gray-700">
            {t('connection.unreachable')}
            {!retrying && secondsToRetry !== null && secondsToRetry > 0 && (
              <> {t('connection.retryCountdown', { seconds: secondsToRetry })}</>
            )}
          </p>
          <button
            type="button"
            onClick={handleTryNow}
            disabled={retrying}
            data-testid="connection-retry-now"
            className="mt-2 min-h-[44px] px-4 rounded-lg bg-[#1B4F72] text-white text-sm font-semibold disabled:opacity-50"
          >
            {t('connection.retryNow')}
          </button>
        </div>
      )}
    </section>
  );
};
