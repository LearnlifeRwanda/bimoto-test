import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Spinner } from '../../components/ui/Spinner';
import {
  useDriverPayout,
  PayoutPreference,
  RequestOtpResult,
  ChangePreferenceResult,
} from '../../hooks/useDriverPayout';
import { apiFetch, apiErrorFromResponse } from '../../lib/api';
import { ErrorState } from '../../components/ui/ErrorState';
import { DriverEarningsCard } from '../../components/driver/DriverEarningsCard';
import { PAYOUT_TRANSFER_FEE_RWF } from '@bimoto/shared';
import { MoneyPinPanel } from '../../components/money/MoneyPinPanel';

// R3-N-5 — driver account-status snapshot. Mirrors the server
// DriverAccountStatus interface verbatim.
type DriverAccountStatusValue = 'ACTIVE' | 'SUSPENDED' | 'FLAGGED';

export interface DriverAccountStatus {
  status: DriverAccountStatusValue;
  suspendedUntil: string | null;
  isFlagged: boolean;
  counters: {
    noShowCount: number;
    cancellationCount: number;
    lateMarkCount: number;
    wrongVehicleCount: number;
    driverInitiatedCancellationCount: number;
    completedRides: number;
  };
  thresholds: {
    noShowWarning: number;
    noShowSuspension24h: number;
    noShowFlag: number;
  };
  recentDisputes: Array<{
    journeyId: string;
    cancelledAt: string | null;
    driverDisputedAt: string;
    resolution: {
      decision: 'OVERTURN_FLAG' | 'UPHOLD_FLAG' | 'NO_ACTION' | null;
      decidedAt: string | null;
      reason: string | null;
    };
  }>;
}

const STATUS_BG: Record<DriverAccountStatusValue, string> = {
  ACTIVE: 'bg-[#27AE60]/10 text-[#27AE60] border-[#27AE60]/30',
  SUSPENDED: 'bg-yellow-50 text-yellow-700 border-yellow-300',
  FLAGGED: 'bg-[#E74C3C]/10 text-[#E74C3C] border-[#E74C3C]/30',
};

interface StatusBannerProps {
  status: DriverAccountStatusValue;
  suspendedUntil: string | null;
}

const StatusBanner: React.FC<StatusBannerProps> = ({ status, suspendedUntil }) => {
  const { t } = useTranslation();
  let label: string;
  if (status === 'FLAGGED') {
    label = t('account.statusFlagged');
  } else if (status === 'SUSPENDED' && suspendedUntil) {
    const until = new Date(suspendedUntil);
    label = t('account.statusSuspended', {
      until: `${until.toLocaleDateString()} ${until.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })}`,
    });
  } else {
    label = t('account.statusActive');
  }
  return (
    <div
      data-testid="account-status-banner"
      data-status={status}
      className={`rounded-xl border px-4 py-3 text-sm font-semibold ${STATUS_BG[status]}`}
    >
      {label}
    </div>
  );
};

interface ThresholdMarker {
  value: number;
  label: string;
}

interface CounterCardProps {
  label: string;
  value: number;
  thresholds?: ThresholdMarker[];
}

const CounterCard: React.FC<CounterCardProps> = ({ label, value, thresholds }) => (
  <div
    data-testid="account-counter-card"
    data-label={label}
    className="bg-white rounded-xl shadow-sm p-4"
  >
    <div className="flex items-baseline justify-between mb-1">
      <span className="text-sm text-gray-700">{label}</span>
      <span className="text-lg font-bold text-[#1B4F72]">{value}</span>
    </div>
    {thresholds && thresholds.length > 0 && (
      <ul className="text-xs text-gray-500 mt-1 space-y-0.5">
        {thresholds.map((tier) => (
          <li
            key={tier.label}
            className={value >= tier.value ? 'text-[#E74C3C] font-medium' : ''}
          >
            {tier.label}: {value} / {tier.value}
          </li>
        ))}
      </ul>
    )}
  </div>
);

const RESOLUTION_KEY: Record<
  NonNullable<DriverAccountStatus['recentDisputes'][number]['resolution']['decision']>,
  string
> = {
  OVERTURN_FLAG: 'account.disputeUpheld',
  UPHOLD_FLAG: 'account.disputeRejected',
  NO_ACTION: 'account.disputeClosedNoAction',
};

interface DisputeRowProps {
  dispute: DriverAccountStatus['recentDisputes'][number];
}

const DisputeRow: React.FC<DisputeRowProps> = ({ dispute }) => {
  const { t } = useTranslation();
  const filed = new Date(dispute.driverDisputedAt);
  const decisionKey = dispute.resolution.decision;
  const labelKey = decisionKey ? RESOLUTION_KEY[decisionKey] : 'account.disputePending';
  return (
    <li
      data-testid="account-dispute-row"
      data-decision={decisionKey ?? 'PENDING'}
      className="bg-white rounded-xl shadow-sm p-3 text-sm"
    >
      <div className="flex items-center justify-between">
        <span className="font-medium text-gray-800">
          {filed.toLocaleDateString()}
        </span>
        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
          {t(labelKey)}
        </span>
      </div>
      {dispute.resolution.reason && (
        <p className="text-xs text-gray-500 mt-1 italic">
          {dispute.resolution.reason}
        </p>
      )}
    </li>
  );
};

// PAYOUT-C — payout schedule chooser. Radio-style list of the three
// preferences in plain language; changing one walks through the OTP
// flow (request → 6-digit code → confirm). The 1-per-24h limit and
// the ~30-minute cooldown after a change are stated up front; the
// rate-limited response itself surfaces as an info toast from the
// hook, not a failure.
const PREFERENCE_ORDER: PayoutPreference[] = ['TWICE_DAILY', 'DAILY_22H', 'AT_SHIFT_END'];

const PREF_LABEL_KEY: Record<PayoutPreference, string> = {
  TWICE_DAILY: 'payout.prefTwiceDaily',
  DAILY_22H: 'payout.prefDaily22h',
  AT_SHIFT_END: 'payout.prefAtShiftEnd',
};

const PREF_DESC_KEY: Record<PayoutPreference, string> = {
  TWICE_DAILY: 'payout.prefTwiceDailyDesc',
  DAILY_22H: 'payout.prefDaily22hDesc',
  AT_SHIFT_END: 'payout.prefAtShiftEndDesc',
};

// TEAM-SAID G2 — what each choice costs, said on the screen that
// offers it (item 11, Option A, 5 of 7).
//
// All three preferences ARE the scheduled payout, so all three cost
// the driver nothing: Bimoto covers the transfer fee. The 500 RWF he
// can actually be charged is the one this screen never mentioned —
// an immediate, off-schedule withdrawal — so that is stated once,
// below the three rows, rather than three times inside them.
//
// Display only. No money moves in the pilot, no payout logic is
// touched, and the existing commission fee waiver is a different
// thing that stays exactly as it was.
const PREF_COST_KEY: Record<PayoutPreference, string> = {
  TWICE_DAILY: 'payout.costScheduled',
  DAILY_22H: 'payout.costScheduled',
  AT_SHIFT_END: 'payout.costScheduled',
};

const PayoutPreferenceSection: React.FC = () => {
  const { t } = useTranslation();
  const { summary, requestPreferenceOtp, changePreference, moneyPinPrompt } =
    useDriverPayout();

  const [selected, setSelected] = useState<PayoutPreference | null>(null);
  const [otp, setOtp] = useState<RequestOtpResult | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState<ChangePreferenceResult | null>(null);

  // MONEY-PIN — this section's own slot, checked before the bail below.
  //
  // Payout preferences ARE a money surface, so the gate refusing here is
  // correct and intended. What was wrong was the consequence: no summary
  // meant `return null`, so the section vanished entirely and the driver
  // was left with nothing to act on. It renders the pad instead, in
  // place, and the rest of the Account page carries on.
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
      <section data-testid="payout-preference-section">
        <h2 className="text-lg font-semibold text-gray-800 mb-2">
          {t('payout.prefSectionTitle')}
        </h2>
        <MoneyPinPanel />
      </section>
    );
  }

  // Bail on missing or malformed summary — the account page must keep
  // rendering its status sections even if the payout API misbehaves.
  if (!summary || !summary.storedPreference) return null;

  const selectPreference = (pref: PayoutPreference) => {
    setChanged(null);
    setOtp(null);
    setCode('');
    setSelected(pref === summary.storedPreference ? null : pref);
  };

  const handleRequestOtp = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const result = await requestPreferenceOtp(selected);
      if (result) setOtp(result);
    } finally {
      setBusy(false);
    }
  };

  const handleConfirm = async () => {
    if (!selected || !otp) return;
    setBusy(true);
    try {
      const result = await changePreference(selected, otp.otpId, code.trim());
      if (result) {
        setChanged(result);
        setSelected(null);
        setOtp(null);
        setCode('');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section data-testid="payout-preference-section">
      <h2 className="text-lg font-semibold text-gray-800 mb-2">
        {t('payout.prefSectionTitle')}
      </h2>

      <div className="space-y-2" role="radiogroup" aria-label={t('payout.prefSectionTitle')}>
        {PREFERENCE_ORDER.map((pref) => {
          const isCurrent = pref === summary.storedPreference;
          const isSelected = pref === (selected ?? summary.storedPreference);
          return (
            <button
              key={pref}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => selectPreference(pref)}
              data-testid={`payout-pref-option-${pref}`}
              data-current={isCurrent || undefined}
              className={`w-full text-left bg-white rounded-xl shadow-sm p-4 border-2 transition-colors ${
                isSelected ? 'border-[#1B4F72]' : 'border-transparent'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-800">
                  {t(PREF_LABEL_KEY[pref])}
                </span>
                {isCurrent && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-[#27AE60]/10 text-[#27AE60] font-medium">
                    {t('payout.currentChoice')}
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-500 mt-1">{t(PREF_DESC_KEY[pref])}</p>
              {/* TEAM-SAID G2 — the cost of this choice, next to the
                  choice. Green because the honest answer is "nothing". */}
              <p
                className="text-xs text-[#27AE60] font-medium mt-1"
                data-testid={`payout-pref-cost-${pref}`}
              >
                {t(PREF_COST_KEY[pref], { fee: PAYOUT_TRANSFER_FEE_RWF })}
              </p>
            </button>
          );
        })}
      </div>

      {/* TEAM-SAID G2 — and the one case where the driver does pay.
          Stated in the same breath as the free choices so the screen
          is honest about the whole picture rather than the flattering
          half of it. */}
      <p
        className="text-xs text-gray-600 bg-gray-50 rounded-lg px-3 py-2 mt-2"
        data-testid="payout-immediate-fee-note"
      >
        {t('payout.costImmediateWithdrawal', { fee: PAYOUT_TRANSFER_FEE_RWF })}
      </p>

      {summary.trainingWheelsActive && (
        <p className="text-xs text-[#1B4F72] bg-[#1B4F72]/10 rounded-lg px-3 py-2 mt-2">
          {t('payout.trainingWheelsExplainer', { count: summary.completedShifts })}
        </p>
      )}

      {selected && !otp && (
        <div className="mt-3 space-y-2" data-testid="payout-pref-confirm-panel">
          <p className="text-xs text-gray-600">{t('payout.changeLimitNote')}</p>
          <p className="text-xs text-gray-600">{t('payout.cooldownNote')}</p>
          <button
            type="button"
            onClick={handleRequestOtp}
            disabled={busy}
            className="w-full min-h-[44px] py-2 rounded-full bg-[#1B4F72] text-white text-sm font-bold hover:bg-[#154360] transition-colors disabled:opacity-50"
            data-testid="payout-pref-send-code"
          >
            {busy ? <Spinner size="sm" className="mx-auto" /> : t('payout.sendCode')}
          </button>
        </div>
      )}

      {selected && otp && (
        <div className="mt-3 space-y-2" data-testid="payout-pref-otp-panel">
          <p className="text-xs text-gray-600">{t('payout.codeSent')}</p>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder={t('payout.codePlaceholder')}
            aria-label={t('payout.codeInputLabel')}
            className="w-full rounded-xl border border-gray-300 px-4 py-3 text-center text-lg tracking-[0.5em] focus:outline-none focus:border-[#1B4F72]"
            data-testid="payout-pref-code-input"
          />
          <button
            type="button"
            onClick={handleConfirm}
            disabled={busy || code.length !== 6}
            className="w-full min-h-[44px] py-2 rounded-full bg-[#1B4F72] text-white text-sm font-bold hover:bg-[#154360] transition-colors disabled:opacity-50"
            data-testid="payout-pref-confirm"
          >
            {busy ? <Spinner size="sm" className="mx-auto" /> : t('payout.confirmChange')}
          </button>
        </div>
      )}

      {changed && (
        <div
          className="mt-3 rounded-lg bg-[#27AE60]/10 text-[#27AE60] px-3 py-2 text-sm font-medium"
          data-testid="payout-pref-success"
        >
          <p>{t('payout.prefChangeSuccess')}</p>
          {changed.immediatePayoutQueued && changed.queuedFor && (
            <p className="text-xs mt-1">
              {t('payout.pendingFollows', {
                time: new Date(changed.queuedFor).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                }),
              })}
            </p>
          )}
        </div>
      )}

      {/* Basic-phone fallback: the SMS BALANCE keyword works without the app. */}
      <p className="text-xs text-gray-500 mt-3">{t('payout.smsFallback')}</p>
    </section>
  );
};

export const AccountPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [data, setData] = useState<DriverAccountStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  // NET-UX G3 — retry re-runs the account-status load.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    apiFetch(`/api/users/me/account-status`, {
      credentials: 'include',
    })
      .then((r) => (r.ok ? r.json() : apiErrorFromResponse(r).then((apiErr) => Promise.reject(apiErr))))
      .then((d: DriverAccountStatus) => {
        if (!cancelled) setData(d);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 px-4 py-6">
        <ErrorState
          title={t('account.fetchFailed')}
          onRetry={() => setReloadKey((k) => k + 1)}
        />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-6">
      <div className="w-full max-w-sm mx-auto space-y-4">
        <h1 className="text-xl font-bold text-[#1B4F72]">{t('account.title')}</h1>

        {/* MONEY-UX G4 — the wallet destination leads with the money:
            the same "Your money today" card the Dashboard shows
            (identical hook and behaviour), above the payout-schedule
            chooser that already lived here. Reuse only — no payout
            logic changes. */}
        <DriverEarningsCard className="" />

        <StatusBanner status={data.status} suspendedUntil={data.suspendedUntil} />

        <div className="space-y-2">
          <CounterCard
            label={t('account.noShowCount')}
            value={data.counters.noShowCount}
            thresholds={[
              {
                value: data.thresholds.noShowWarning,
                label: t('account.warningThreshold'),
              },
              {
                value: data.thresholds.noShowSuspension24h,
                label: t('account.suspensionThreshold'),
              },
              {
                value: data.thresholds.noShowFlag,
                label: t('account.flagThreshold'),
              },
            ]}
          />
          <CounterCard
            label={t('account.cancellationCount')}
            value={data.counters.cancellationCount}
          />
          <CounterCard
            label={t('account.lateMarkCount')}
            value={data.counters.lateMarkCount}
          />
          <CounterCard
            label={t('account.wrongVehicleCount')}
            value={data.counters.wrongVehicleCount}
          />
          <CounterCard
            label={t('account.driverInitiatedCancellationCount')}
            value={data.counters.driverInitiatedCancellationCount}
          />
        </div>

        {/* PAYOUT-C — payout schedule chooser with OTP-confirmed changes. */}
        <PayoutPreferenceSection />

        {/* TEAM-SAID G4 — the way in to the auto-bid rules screen.
            The entry says the feature is off before the driver taps
            it, so nobody walks in expecting bids tonight. */}
        <section data-testid="auto-bid-entry-section">
          <h2 className="text-lg font-semibold text-gray-800 mb-2">
            {t('autoBid.title')}
          </h2>
          <button
            type="button"
            onClick={() => navigate('/driver/auto-bid')}
            data-testid="auto-bid-entry"
            className="w-full text-left bg-white rounded-xl shadow-sm p-4 border-2 border-transparent hover:border-[#1B4F72] transition-colors min-h-[44px]"
          >
            <span className="text-sm font-semibold text-gray-800">
              {t('autoBid.entryLabel')}
            </span>
            <p className="text-xs text-gray-500 mt-1">{t('autoBid.entryHint')}</p>
          </button>
        </section>

        {/* DEADWOOD G3 — the way in to the no-show disputes screen.
            /driver/no-show-disputes was built in R3-N-4 and then had no
            door: nothing in the app linked to it, so a motari wrongly
            marked absent could only reach his own defence by typing a
            URL. The account screen is where the no-show COUNT that
            screen exists to contest is already shown (see
            account.noShowCount above), so the entry belongs here. Same
            list-row shape as the auto-bid entry above; no badge or
            count — that is a later decision, not this one. */}
        <section data-testid="no-show-disputes-entry-section">
          <h2 className="text-lg font-semibold text-gray-800 mb-2">
            {t('driver.cancelledTrips.title')}
          </h2>
          <button
            type="button"
            onClick={() => navigate('/driver/no-show-disputes')}
            data-testid="no-show-disputes-entry"
            className="w-full text-left bg-white rounded-xl shadow-sm p-4 border-2 border-transparent hover:border-[#1B4F72] transition-colors min-h-[44px]"
          >
            <span className="text-sm font-semibold text-gray-800">
              {t('driver.cancelledTrips.entryLabel')}
            </span>
            <p className="text-xs text-gray-500 mt-1">
              {t('driver.cancelledTrips.entryHint')}
            </p>
          </button>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-gray-800 mb-2">
            {t('account.recentDisputes')}
          </h2>
          {data.recentDisputes.length === 0 ? (
            <p className="text-sm text-gray-500">{t('account.noRecentDisputes')}</p>
          ) : (
            <ul className="space-y-2">
              {data.recentDisputes.map((d) => (
                <DisputeRow key={d.journeyId} dispute={d} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
};

export default AccountPage;
