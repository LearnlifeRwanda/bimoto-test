// PAGES/DRIVER/AUTOBIDRULESPAGE.TSX
//
// TEAM-SAID G4 — the auto-bid rules screen: built, and dark.
//
// Five of seven voted to build this and keep it off (item 12). The
// server side has been complete since Dispatch K2 and unreachable ever
// since, because no client screen existed. This is that screen, built
// against routes/driver-auto-bid.routes.ts exactly as it stands — no
// server file is touched.
//
// "Dark" is a real property here, not a label. See the header comment
// in hooks/useDriverAutoBid.ts: the evaluator is wired live into the
// discovery cascade, so a rule created with enabled: true would bid.
// Every rule this screen creates is posted with enabled: false, which
// the evaluator skips, and resume-all — the one call that could arm
// every rule at once — is closed while AUTO_BID_PILOT_ENABLED is false.
// A driver can write his rules today and they wait.
//
// The form fields are the server's RuleInput and nothing else. Two
// notes on that, both reported rather than papered over:
//   - priority is a RuleInput field, assigned here rather than typed:
//     the route rejects duplicates (PRIORITY_TAKEN) and anything
//     outside [0,4], so the screen picks the lowest free slot and
//     shows the resulting order.
//   - vehicleTypeFilter offers exactly the values the route's zod enum
//     accepts ('MOTO' | 'BIKE' | 'E_MOTO' | 'E_BIKE'). FLIGHT-RECORDER
//     G5.4 added the last of those: E_BIKE is a member of the shared
//     VehicleType enum and was the only one this list never named, so
//     an e-bike driver's only honest choice was "any machine". It used
//     to offer
//     'EMOTO', which is not a member of the shared VehicleType enum:
//     the evaluator compares the filter against
//     journey.vehiclePreference with !==, so an e-moto rule could
//     never fire. DEADWOOD G4 fixed the route; this screen now sends
//     the canonical spelling.

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Spinner } from '../../components/ui/Spinner';
import {
  useDriverAutoBid,
  AUTO_BID_PILOT_ENABLED,
  MAX_AUTO_BID_RULES,
  type AutoBidRule,
  type AutoBidVehicleFilter,
  type BidAmountMode,
} from '../../hooks/useDriverAutoBid';

// The route's own bounds (services/auto-bid/config.ts defaults). The
// server re-validates every one of these; stating them here is so the
// driver reads the limit before the rejection, not after.
const MIN_PICKUP_M = 1;
const MAX_PICKUP_M = 10_000;
const MIN_RIDE_M = 1;
const MAX_RIDE_M = 50_000;
const FLAT_MIN_RWF = 100;
const FLAT_MAX_RWF = 50_000;
const PERCENT_MIN = 50;
const PERCENT_MAX = 200;

const VEHICLE_FILTERS: { value: AutoBidVehicleFilter; labelKey: string }[] = [
  { value: null, labelKey: 'autoBid.vehicleAny' },
  { value: 'MOTO', labelKey: 'autoBid.vehicleMoto' },
  { value: 'BIKE', labelKey: 'autoBid.vehicleBike' },
  { value: 'E_MOTO', labelKey: 'autoBid.vehicleEmoto' },
  { value: 'E_BIKE', labelKey: 'autoBid.vehicleEbike' },
];

const RuleCard: React.FC<{
  rule: AutoBidRule;
  onDelete: () => void;
  busy: boolean;
}> = ({ rule, onDelete, busy }) => {
  const { t } = useTranslation();
  return (
    <li
      className="bg-white rounded-xl shadow-sm p-4 space-y-1"
      data-testid={`auto-bid-rule-${rule.id}`}
      data-priority={rule.priority}
      data-enabled={rule.enabled}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-800">
          {t('autoBid.ruleOrder', { n: rule.priority + 1 })}
        </span>
        <span
          className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium"
          data-testid={`auto-bid-rule-state-${rule.id}`}
        >
          {rule.enabled ? t('autoBid.stateActive') : t('autoBid.stateWaiting')}
        </span>
      </div>
      <p className="text-xs text-gray-600">
        {t('autoBid.summaryDistances', {
          pickupKm: (rule.maxPickupDistanceM / 1000).toFixed(1),
          rideKm: (rule.maxRideDistanceM / 1000).toFixed(1),
        })}
      </p>
      <p className="text-xs text-gray-600">
        {rule.bidAmountMode === 'FLAT'
          ? t('autoBid.summaryFlat', { amount: rule.bidAmountValue })
          : t('autoBid.summaryPercent', { percent: rule.bidAmountValue })}
      </p>
      <p className="text-xs text-gray-600">
        {t('autoBid.summaryVehicle', {
          vehicle: rule.vehicleTypeFilter ?? t('autoBid.vehicleAny'),
        })}
      </p>
      <button
        type="button"
        onClick={onDelete}
        disabled={busy}
        className="text-xs text-red-700 underline min-h-[44px]"
        data-testid={`auto-bid-delete-${rule.id}`}
      >
        {t('autoBid.deleteRule')}
      </button>
    </li>
  );
};

export const AutoBidRulesPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { rules, loading, busy, createRule, deleteRule, pauseAll, atCap } =
    useDriverAutoBid();

  const [showForm, setShowForm] = useState(false);
  const [maxPickupKm, setMaxPickupKm] = useState('3');
  const [maxRideKm, setMaxRideKm] = useState('10');
  const [vehicleTypeFilter, setVehicleTypeFilter] = useState<AutoBidVehicleFilter>(null);
  const [bidAmountMode, setBidAmountMode] = useState<BidAmountMode>('FLAT');
  const [bidAmountValue, setBidAmountValue] = useState('1500');

  const pickupM = Math.round(Number(maxPickupKm) * 1000);
  const rideM = Math.round(Number(maxRideKm) * 1000);
  const amount = Number(bidAmountValue);

  const amountMin = bidAmountMode === 'FLAT' ? FLAT_MIN_RWF : PERCENT_MIN;
  const amountMax = bidAmountMode === 'FLAT' ? FLAT_MAX_RWF : PERCENT_MAX;

  const formValid =
    Number.isFinite(pickupM) &&
    pickupM >= MIN_PICKUP_M &&
    pickupM <= MAX_PICKUP_M &&
    Number.isFinite(rideM) &&
    rideM >= MIN_RIDE_M &&
    rideM <= MAX_RIDE_M &&
    Number.isFinite(amount) &&
    amount >= amountMin &&
    amount <= amountMax;

  const handleCreate = async () => {
    const created = await createRule({
      maxPickupDistanceM: pickupM,
      maxRideDistanceM: rideM,
      vehicleTypeFilter,
      bidAmountMode,
      bidAmountValue: amount,
    });
    if (created) setShowForm(false);
  };

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-6">
      <div className="w-full max-w-sm mx-auto space-y-4">
        <h1 className="text-xl font-bold text-[#1B4F72]">{t('autoBid.title')}</h1>

        {/* The screen says what it is before it says anything else.
            A driver who writes five rules and then waits for bids that
            never come has been misled by us, not by the feature. */}
        {!AUTO_BID_PILOT_ENABLED && (
          <div
            className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
            role="status"
            data-testid="auto-bid-off-banner"
          >
            <p className="font-semibold">{t('autoBid.offTitle')}</p>
            <p className="mt-1 text-xs">{t('autoBid.offBody')}</p>
          </div>
        )}

        <p className="text-sm text-gray-600">{t('autoBid.intro')}</p>

        {loading ? (
          <div className="flex justify-center py-8">
            <Spinner size="lg" />
          </div>
        ) : (
          <>
            {rules.length === 0 ? (
              <p className="text-sm text-gray-500" data-testid="auto-bid-empty">
                {t('autoBid.noRules')}
              </p>
            ) : (
              <ul className="space-y-2" data-testid="auto-bid-rule-list">
                {rules.map((rule) => (
                  <RuleCard
                    key={rule.id}
                    rule={rule}
                    busy={busy}
                    onDelete={() => void deleteRule(rule.id)}
                  />
                ))}
              </ul>
            )}

            <p className="text-xs text-gray-500" data-testid="auto-bid-cap-note">
              {t('autoBid.capNote', { used: rules.length, max: MAX_AUTO_BID_RULES })}
            </p>

            {/* One tap to silence every rule. Always available: pausing
                can only ever make auto-bid quieter, so it needs no
                pilot flag guarding it. Its opposite, resume-all, does
                — see below. */}
            <Button
              variant="secondary"
              fullWidth
              onClick={() => void pauseAll()}
              disabled={busy || rules.length === 0}
              data-testid="auto-bid-pause-all"
            >
              {t('autoBid.pauseAll')}
            </Button>

            {/* resume-all exists on the route and is built here, but a
                single tap on it would arm every rule against a live
                evaluator. It stays closed until auto-bid is turned on
                for the pilot, and says so rather than vanishing. */}
            <div>
              <Button
                variant="secondary"
                fullWidth
                onClick={() => undefined}
                disabled
                data-testid="auto-bid-resume-all"
              >
                {t('autoBid.resumeAll')}
              </Button>
              {!AUTO_BID_PILOT_ENABLED && (
                <p
                  className="text-xs text-gray-500 mt-1"
                  data-testid="auto-bid-resume-blocked-note"
                >
                  {t('autoBid.resumeAllBlocked')}
                </p>
              )}
            </div>

            {atCap ? (
              <p
                className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700"
                role="status"
                data-testid="auto-bid-at-cap"
              >
                {t('autoBid.atCap', { max: MAX_AUTO_BID_RULES })}
              </p>
            ) : showForm ? (
              <div
                className="bg-white rounded-xl shadow-sm p-4 space-y-4"
                data-testid="auto-bid-form"
              >
                <h2 className="text-base font-semibold text-gray-900">
                  {t('autoBid.newRule')}
                </h2>

                {/* RuleInput.enabled. Shown, because it is a field the
                    server accepts and a driver should see what state
                    his rule will be in — not silently omitted. */}
                <div
                  className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2"
                  data-testid="auto-bid-enabled-row"
                >
                  <span className="text-sm font-medium text-gray-700">
                    {t('autoBid.enabledLabel')}
                  </span>
                  <span
                    className="text-xs text-gray-600"
                    data-testid="auto-bid-enabled-value"
                  >
                    {AUTO_BID_PILOT_ENABLED
                      ? t('autoBid.stateActive')
                      : t('autoBid.stateWaiting')}
                  </span>
                </div>

                {/* RuleInput.maxPickupDistanceM — entered in km, sent in m. */}
                <div>
                  <Input
                    label={t('autoBid.maxPickupLabel')}
                    type="number"
                    inputMode="decimal"
                    min="0"
                    value={maxPickupKm}
                    onChange={(e) => setMaxPickupKm(e.target.value)}
                    suffix="km"
                    data-testid="auto-bid-max-pickup"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    {t('autoBid.maxPickupHelp', { max: MAX_PICKUP_M / 1000 })}
                  </p>
                </div>

                {/* RuleInput.maxRideDistanceM — entered in km, sent in m. */}
                <div>
                  <Input
                    label={t('autoBid.maxRideLabel')}
                    type="number"
                    inputMode="decimal"
                    min="0"
                    value={maxRideKm}
                    onChange={(e) => setMaxRideKm(e.target.value)}
                    suffix="km"
                    data-testid="auto-bid-max-ride"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    {t('autoBid.maxRideHelp', { max: MAX_RIDE_M / 1000 })}
                  </p>
                </div>

                {/* RuleInput.vehicleTypeFilter */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t('autoBid.vehicleLabel')}
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {VEHICLE_FILTERS.map((opt) => (
                      <button
                        key={opt.value ?? 'ANY'}
                        type="button"
                        onClick={() => setVehicleTypeFilter(opt.value)}
                        aria-pressed={vehicleTypeFilter === opt.value}
                        data-testid={`auto-bid-vehicle-${opt.value ?? 'ANY'}`}
                        className={`min-h-[44px] px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                          vehicleTypeFilter === opt.value
                            ? 'border-[#1B4F72] bg-[#1B4F72] text-white'
                            : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
                        }`}
                      >
                        {t(opt.labelKey)}
                      </button>
                    ))}
                  </div>
                </div>

                {/* RuleInput.bidAmountMode */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t('autoBid.amountModeLabel')}
                  </label>
                  <div className="flex gap-2" role="radiogroup">
                    {(['FLAT', 'PERCENT_OF_FAIR_PRICE'] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        role="radio"
                        aria-checked={bidAmountMode === mode}
                        onClick={() => {
                          setBidAmountMode(mode);
                          setBidAmountValue(mode === 'FLAT' ? '1500' : '110');
                        }}
                        data-testid={`auto-bid-mode-${mode}`}
                        className={`flex-1 min-h-[44px] px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                          bidAmountMode === mode
                            ? 'border-[#1B4F72] bg-[#1B4F72] text-white'
                            : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
                        }`}
                      >
                        {t(mode === 'FLAT' ? 'autoBid.modeFlat' : 'autoBid.modePercent')}
                      </button>
                    ))}
                  </div>
                </div>

                {/* RuleInput.bidAmountValue */}
                <div>
                  <Input
                    label={
                      bidAmountMode === 'FLAT'
                        ? t('autoBid.amountFlatLabel')
                        : t('autoBid.amountPercentLabel')
                    }
                    type="number"
                    inputMode="numeric"
                    value={bidAmountValue}
                    onChange={(e) => setBidAmountValue(e.target.value)}
                    suffix={bidAmountMode === 'FLAT' ? 'RWF' : '%'}
                    data-testid="auto-bid-amount"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    {t('autoBid.amountHelp', { min: amountMin, max: amountMax })}
                  </p>
                </div>

                <div className="flex gap-2">
                  <Button
                    fullWidth
                    onClick={() => void handleCreate()}
                    loading={busy}
                    disabled={!formValid || busy}
                    data-testid="auto-bid-save"
                  >
                    {t('autoBid.saveRule')}
                  </Button>
                  <Button
                    variant="secondary"
                    fullWidth
                    onClick={() => setShowForm(false)}
                    data-testid="auto-bid-cancel"
                  >
                    {t('common.cancel')}
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                fullWidth
                onClick={() => setShowForm(true)}
                data-testid="auto-bid-add-rule"
              >
                {t('autoBid.addRule')}
              </Button>
            )}
          </>
        )}

        <button
          type="button"
          onClick={() => navigate('/driver/account')}
          className="text-sm text-[#1B4F72] underline min-h-[44px]"
        >
          {t('common.back')}
        </button>
      </div>
    </div>
  );
};

export default AutoBidRulesPage;
