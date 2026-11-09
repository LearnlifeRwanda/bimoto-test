// COMPONENTS/DRIVER/DRIVER-EARNINGS-CARD.TSX
//
// Dispatch PAYOUT-C — driver money widget on the Dashboard. Shows
// today's pending balance from GET /api/payout/summary, one
// plain-language line explaining when the money reaches the driver's
// MoMo wallet (driven by the effective payout preference, with a
// training-wheels explainer for new drivers), and a "Pay me now"
// button when the driver's effective preference is AT_SHIFT_END.
//
// Zero balance is a designed state, not a blank: the card stays
// visible with an encouraging empty line so day-1 drivers learn where
// their money will appear. On fetch error the card renders nothing
// (same graceful degradation as DriverStatsCard) — the hook already
// surfaces a toast.

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Spinner } from '../ui/Spinner';
import { useDriverPayout, EndShiftResult } from '../../hooks/useDriverPayout';
import { MoneyPinPanel } from '../money/MoneyPinPanel';

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// MONEY-UX G4 — className lets the wallet screen (AccountPage) mount
// the card without the Dashboard's outer margins. Display-only; the
// money behaviour is identical wherever the card renders.
export interface DriverEarningsCardProps {
  className?: string;
}

export const DriverEarningsCard: React.FC<DriverEarningsCardProps> = ({
  className = 'mx-4 mt-4',
}) => {
  const { t } = useTranslation();
  const { summary, loading, refresh, endShift, moneyPinPrompt } = useDriverPayout();
  const [paying, setPaying] = useState(false);
  const [paid, setPaid] = useState<EndShiftResult | null>(null);

  const handlePayMeNow = async () => {
    setPaying(true);
    try {
      const result = await endShift();
      if (result && result.batchId) {
        setPaid(result);
      }
      // Refresh regardless of outcome so the balance reflects server
      // state (double-fire protection lives server-side; the disabled
      // button while in flight is the client's half of it).
      await refresh();
    } finally {
      setPaying(false);
    }
  };

  // MONEY-PIN — the enrolment/verify slot, IN THE CARD'S OWN BOX.
  //
  // Checked BEFORE the loading and null-summary branches, because both of
  // those are reached when the gate refuses: the summary never arrives,
  // so the card used to `return null` and vanish. A driver with no PIN
  // therefore saw no balance AND no way to get one — while a full-screen
  // pad covered the rest of his dashboard. Both halves of that are fixed
  // here: the card stays on the page, in its slot, and says what to do.
  //
  // Everything else on the dashboard — the feed, the online toggle, the
  // requests, the nav — is untouched by this branch, which is the whole
  // point of it being a branch inside one card.
  // Only an EXPLICIT prompt draws the pad. `undefined` means "not
  // prompting", which matters beyond tidiness: a hook mock written before
  // this field existed returns an object without it, and treating that as
  // "prompted" would make every such test render a PIN pad where it
  // expects a balance. That is the mock-drift class #202 closed on the
  // server (a stand-in is a list of names some other file keeps growing);
  // the same defence here is to fail SAFE, toward the pre-existing
  // behaviour, rather than toward the new branch.
  if (moneyPinPrompt && moneyPinPrompt !== 'closed') {
    return (
      <div
        className={`${className} bg-white rounded-xl shadow-sm p-4`}
        data-testid="driver-earnings-card"
      >
        <MoneyPinPanel />
      </div>
    );
  }

  if (loading && !summary) {
    return (
      <div
        className={`${className} bg-white rounded-xl shadow-sm p-4 flex justify-center`}
        data-testid="driver-earnings-card-loading"
      >
        <Spinner size="sm" />
      </div>
    );
  }

  // Also bail on a malformed payload (e.g. a proxy error page parsed as
  // JSON) — a money widget must never crash the whole dashboard.
  if (!summary || typeof summary.pendingAmount !== 'number') return null;

  const scheduleLine =
    summary.effectivePreference === 'AT_SHIFT_END'
      ? t('payout.scheduleAtShiftEnd')
      : summary.effectivePreference === 'TWICE_DAILY'
        ? t('payout.scheduleTwiceDaily')
        : t('payout.scheduleDaily22h');

  return (
    <div className={`${className} bg-white rounded-xl shadow-sm p-4`} data-testid="driver-earnings-card">
      <h3 className="text-sm font-semibold text-gray-700 mb-2">{t('payout.title')}</h3>

      {/* Balance */}
      <div className="flex items-baseline gap-2">
        <span
          className="text-2xl font-bold text-gray-900"
          data-testid="driver-earnings-balance"
        >
          {summary.pendingAmount.toLocaleString()} RWF
        </span>
        <span className="text-xs text-gray-500">{t('payout.balanceLabel')}</span>
      </div>

      {summary.pendingAmount === 0 && !paid && (
        <p className="text-xs text-gray-500 mt-1" data-testid="driver-earnings-empty">
          {t('payout.emptyBalance')}
        </p>
      )}

      {/* LAUNCH-TRUTH G4 — active pilot fee waiver. The cliff is shown
          IN ADVANCE: a driver must never discover the waiver's end in a
          smaller payout. */}
      {summary.feeWaiver && (
        <p
          className="text-sm text-[#27AE60] bg-[#27AE60]/10 rounded-lg px-3 py-2 mt-2"
          data-testid="driver-earnings-fee-waiver"
        >
          {summary.feeWaiver.type === 'LIFETIME' || !summary.feeWaiver.expiresAt
            ? t('payout.waiverLifetime')
            : t('payout.waiverTemporary', {
                date: new Date(summary.feeWaiver.expiresAt).toLocaleDateString(),
              })}
        </p>
      )}

      {/* Paused state — balance stays visible; the schedule promise and the
          pay-now affordance give way to one calm notice. */}
      {summary.payoutsFrozen && (
        <p
          className="text-sm text-[#1B4F72] bg-[#1B4F72]/10 rounded-lg px-3 py-2 mt-2"
          data-testid="driver-earnings-frozen-notice"
        >
          {t('payout.frozenNotice')}
        </p>
      )}

      {!summary.payoutsFrozen && (
        <>
          {/* Schedule line */}
          <p className="text-sm text-gray-600 mt-2" data-testid="driver-earnings-schedule">
            {scheduleLine}
          </p>
          {summary.trainingWheelsActive && (
            <p
              className="text-xs text-[#1B4F72] bg-[#1B4F72]/10 rounded-lg px-3 py-2 mt-2"
              data-testid="driver-earnings-training-wheels"
            >
              {t('payout.trainingWheelsExplainer', { count: summary.completedShifts })}
            </p>
          )}
          {summary.nextScheduledPayout && (
            <p className="text-xs text-gray-500 mt-1" data-testid="driver-earnings-lands-at">
              {t('payout.landsAt', { time: formatTime(summary.nextScheduledPayout) })}
            </p>
          )}

          {/* Pay me now — only when the effective preference allows it */}
          {summary.canEndShift && (
            <button
              type="button"
              onClick={handlePayMeNow}
              disabled={paying || summary.pendingAmount === 0}
              className="w-full mt-3 min-h-[48px] py-3 rounded-full bg-[#27AE60] text-white text-base font-bold hover:bg-[#219653] transition-colors disabled:opacity-50"
              data-testid="driver-earnings-pay-now"
            >
              {paying ? <Spinner size="sm" className="mx-auto" /> : t('payout.payMeNow')}
            </button>
          )}

          {/* Post end-shift confirmation */}
          {paid && paid.batchId && (
            <div
              className="mt-3 rounded-lg bg-[#27AE60]/10 text-[#27AE60] px-3 py-2 text-sm font-medium"
              data-testid="driver-earnings-confirmation"
            >
              {t('payout.endShiftSuccess', {
                amount: paid.amount.toLocaleString(),
                time: paid.expectedDeliveryAt ? formatTime(paid.expectedDeliveryAt) : '',
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default DriverEarningsCard;
