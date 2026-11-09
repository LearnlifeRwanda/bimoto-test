import { useCallback, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '../stores/ui.store';
import { apiFetch, apiErrorFromResponse } from '../lib/api';
import { presentApiError } from '../lib/api-error-presenter';
import { withMoneyStepUp, readGateCode } from '../lib/money-pin';
import { useMoneyPinStore, MoneyPinPrompt } from '../stores/money-pin.store';

export type PayoutPreference = 'AT_SHIFT_END' | 'TWICE_DAILY' | 'DAILY_22H';

export interface PayoutSummary {
  pendingAmount: number;
  storedPreference: PayoutPreference;
  effectivePreference: PayoutPreference;
  trainingWheelsActive: boolean;
  completedShifts: number;
  canEndShift: boolean;
  nextScheduledPayout: string | null;
  payoutsFrozen: boolean;
  // LAUNCH-TRUTH G4 — active pilot fee waiver, minimum shape only.
  // expiresAt is null for LIFETIME. Optional so a pre-waiver server
  // response still parses.
  feeWaiver?: { type: 'LIFETIME' | 'TEMPORARY'; expiresAt: string | null } | null;
}

export interface EndShiftResult {
  batchId: string | null;
  amount: number;
  expectedDeliveryAt: string | null;
}

export interface RequestOtpResult {
  otpId: string;
  expiresAt: string;
}

export interface ChangePreferenceResult {
  newPreference: PayoutPreference;
  immediatePayoutQueued: boolean;
  queuedFor: string | null;
}

// Server error codes → errors.* i18n keys.
//
// PILOT-GUARD Item 2 — these four used to name snake_case catalogue keys
// while the server threw camelCase ones, so the message rendered here
// and nowhere else: any other surface presenting the same rejection went
// through lib/api-error-presenter.ts, found no such key, and fell
// through to the generic "not accepted". The server's key is the
// contract, so the catalogue keys were renamed to its spelling and this
// map follows. (The old spellings are deliberately not quoted anywhere
// in this file — the used-key extractor reads comments too, and a key
// named in prose would be reported as a missing one.)
//
// OTP_INVALID now names the payout guard's own key rather than borrowing
// the login flow's. RATE_LIMITED still reuses a pre-existing key.
const ERROR_KEYS: Record<string, string> = {
  NOT_SHIFT_END_MODE: 'errors.notShiftEndMode',
  INVALID_PREFERENCE: 'errors.invalidPreference',
  PREFERENCE_CHANGE_RATE_LIMITED: 'errors.preferenceChangeRateLimited',
  OTP_REQUIRED: 'errors.otpRequired',
  OTP_INVALID: 'errors.otpInvalid',
  RATE_LIMITED: 'errors.rate_limited',
};

// MONEY-PIN G3 — every call in this hook goes through withMoneyStepUp.
//
// These four endpoints ARE the money-surface census: the balance
// snapshot, the manual payout, and the two halves of the preference
// change. The server gates exactly these; the wrapper is what turns a
// gate refusal into a PIN pad and a retry instead of an error toast.
//
// It is deliberately applied at the FETCH, not at the hook's exported
// functions: a retry has to re-run the request, and wrapping the
// exported function would re-run its error handling and its toast too.
//
// EACH INSTANCE OWNS ITS OWN PROMPT (`useId`). The hook returns
// `moneyPinPrompt`, and the component that called renders the pad in its
// own slot. That is the correction the cross-locale-chat E2E forced: the
// first version put ONE pad at the app root as a full-screen overlay, so
// a driver with no PIN found his dashboard covered — the summary fetch
// below runs on mount, and DriverEarningsCard is on the DASHBOARD.
//
// A GATE REFUSAL IS NOT AN ERROR. It is a prompt. The handlers below
// therefore return quietly on a gate code instead of throwing into
// presentApiError — otherwise a driver who taps "not now" gets a red
// toast for having declined something he was only just offered.
export function useDriverPayout() {
  const { t } = useTranslation();
  const showToast = useUIStore((s) => s.showToast);

  // Stable per-instance identity. Two hooks on one page (AccountPage
  // mounts the earnings card AND the preference section) must not both
  // draw a pad for one refusal.
  const owner = useId();
  const moneyPinPrompt = useMoneyPinStore((s) =>
    s.owner === owner ? s.prompt : 'closed',
  ) as MoneyPinPrompt;

  const [summary, setSummary] = useState<PayoutSummary | null>(null);
  const [loading, setLoading] = useState(false);

  // NET-UX G2 — the payout-specific code map keeps its precise copy for
  // known rejections; everything else (5xx, unknown codes) goes through
  // the shared taxonomy presenter instead of a one-size-fits-all toast.
  const surfaceError = useCallback(
    async (res: Response) => {
      // A money-gate refusal that survived the retry means the user
      // declined or is locked out. The panel already says so in its own
      // slot; a toast on top would be the app scolding him for it.
      if (await readGateCode(res)) return undefined;
      const apiErr = await apiErrorFromResponse(res);
      const key = apiErr.code ? ERROR_KEYS[apiErr.code] : undefined;
      if (apiErr.kind === 'REJECTED' && key) {
        // The 1-per-24h preference limit is expected behaviour, not a failure.
        showToast(t(key), apiErr.code === 'PREFERENCE_CHANGE_RATE_LIMITED' ? 'info' : 'error');
      } else {
        presentApiError(apiErr);
      }
      return apiErr.code ?? undefined;
    },
    [showToast, t],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await withMoneyStepUp(
        () =>
          apiFetch(`/api/payout/summary`, {
            credentials: 'include',
          }),
        owner,
      );
      // Refused and not resolved: leave `summary` null and say nothing.
      // The card renders its enrolment slot from `moneyPinPrompt`; the
      // rest of the screen is none of this fetch's business.
      if (await readGateCode(res)) return;
      if (!res.ok) throw await apiErrorFromResponse(res);
      setSummary(await res.json());
    } catch (err) {
      presentApiError(err);
    } finally {
      setLoading(false);
    }
  }, [showToast, t, owner]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const endShift = useCallback(async (): Promise<EndShiftResult | null> => {
    try {
      const res = await withMoneyStepUp(
        () =>
          apiFetch(`/api/payout/end-shift`, {
            method: 'POST',
            credentials: 'include',
          }),
        owner,
      );
      if (!res.ok) {
        await surfaceError(res);
        return null;
      }
      return await res.json();
    } catch (err) {
      presentApiError(err);
      return null;
    }
  }, [surfaceError, owner]);

  const requestPreferenceOtp = useCallback(
    async (newPreference: PayoutPreference): Promise<RequestOtpResult | null> => {
      try {
        const res = await withMoneyStepUp(
          () =>
            apiFetch(`/api/payout/preference/request-otp`, {
              method: 'POST',
              credentials: 'include',
              body: JSON.stringify({ newPreference }),
            }),
          owner,
        );
        if (!res.ok) {
          await surfaceError(res);
          return null;
        }
        return await res.json();
      } catch (err) {
        presentApiError(err);
        return null;
      }
    },
    [surfaceError],
  );

  const changePreference = useCallback(
    async (
      newPreference: PayoutPreference,
      otpId: string,
      code: string,
    ): Promise<ChangePreferenceResult | null> => {
      try {
        const res = await withMoneyStepUp(
          () =>
            apiFetch(`/api/payout/preference`, {
              method: 'POST',
              credentials: 'include',
              body: JSON.stringify({ newPreference, otpId, code }),
            }),
          owner,
        );
        if (!res.ok) {
          await surfaceError(res);
          return null;
        }
        const data = await res.json();
        await refresh();
        return data;
      } catch (err) {
        presentApiError(err);
        return null;
      }
    },
    [surfaceError, refresh],
  );

  return {
    summary,
    loading,
    refresh,
    endShift,
    requestPreferenceOtp,
    changePreference,
    /**
     * The prompt THIS instance owns, or 'closed'. The consuming component
     * renders <MoneyPinPanel/> in its own slot when this is not 'closed'.
     */
    moneyPinPrompt,
  };
}
