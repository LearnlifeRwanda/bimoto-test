import React from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../stores/auth.store';
import { useSimulationStore } from '../../stores/simulation.store';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

// PREPROTO-SIM G4 — persistent "SIMULATION — no real money" banner,
// shown on every authenticated screen while the server reports a
// simulated mode. Dismissible per session only; it comes back on the
// next app start for as long as the pilot runs simulated.
export const SimulationBanner: React.FC = () => {
  const { t } = useTranslation();
  const { isAuthenticated } = useAuthStore();
  const { paymentsMode, smsMode, bannerDismissed, dismissBanner } = useSimulationStore();

  const simulated = paymentsMode === 'simulated' || smsMode === 'simulated';
  if (!isAuthenticated || !simulated || bannerDismissed) return null;

  return (
    <div
      role="status"
      data-testid="simulation-banner"
      className="sticky top-0 z-50 flex items-center justify-between gap-2 bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white"
    >
      <span>{t('simulation.banner')}</span>
      <span className="flex items-center gap-3">
        {smsMode === 'simulated' && (
          // The inbox is guarded server-side (admin session or
          // x-sim-inbox-token header) — the link is for pilot operators;
          // participants without access get a 401, never a code.
          <a
            href={`${API_URL}/api/sim/inbox`}
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            {t('simulation.inboxLink')}
          </a>
        )}
        <button
          type="button"
          onClick={dismissBanner}
          aria-label={t('simulation.dismiss')}
          className="px-1 text-sm leading-none"
        >
          ×
        </button>
      </span>
    </div>
  );
};
