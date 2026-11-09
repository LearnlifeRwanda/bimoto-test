import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/Button';
import { PinPad } from './PinPad';
import { useMoneyPinStore } from '../../stores/money-pin.store';
import {
  setMoneyPin,
  verifyMoneyPin,
  requestMoneyPinReset,
  confirmMoneyPinReset,
} from '../../lib/money-pin';
import { MONEY_PIN_LENGTH, OTP_LENGTH } from '@bimoto/shared';

// MONEY-PIN — the prompt, rendered INSIDE the money component that asked
// for it.
//
// IT WAS A FULL-SCREEN OVERLAY AT THE APP ROOT, AND THAT WAS A BUG. The
// cross-locale-chat E2E caught it: DriverEarningsCard is on the driver
// DASHBOARD and fetches the summary on mount, so a driver with no PIN got
// `fixed inset-0 z-[60] bg-white` across his working screen. Playwright's
// own words — "subtree intercepts pointer events" — on the feed, the
// online toggle, the auto-bid entry and every navigation.
//
// That is the exact thing ruling D25's second half forbids. The lazy
// block means "you cannot see the NUMBER until you set a PIN", never
// "you cannot work". So this renders in a slot, sized by its container,
// and everything around it keeps working.
//
// It still renders NOTHING until a money call is turned away.
//
// FOUR SCREENS, and which one shows is the server's decision, not a
// guess made here — the middleware answers with three distinct codes
// precisely so the client does not have to infer.
//
// THE ENROLMENT SCREEN CANNOT BE DISMISSED INTO THE SURFACE. It has a
// "not now" that CLOSES THE MONEY SCREEN (settle(false), so the caller
// gets its original 401 and renders its own empty state) — not one that
// lets the balance through. That is the lazy-enrolment block: the first
// money surface blocks until a PIN is set. Everywhere else in the app
// stays open, which is why "not now" is a real answer and not a trap.

type Phase = 'entry' | 'confirm';

export const MoneyPinPanel: React.FC = () => {
  const { t } = useTranslation();
  const prompt = useMoneyPinStore((s) => s.prompt);
  const lockedUntil = useMoneyPinStore((s) => s.lockedUntil);
  const settleStore = useMoneyPinStore((s) => s.settle);
  const setPrompt = useMoneyPinStore((s) => s.setPrompt);
  const markStepUpOpen = useMoneyPinStore((s) => s.markStepUpOpen);

  // THE DIGITS LIVE HERE AND ONLY HERE. Component state, cleared on
  // every screen change and gone when this unmounts. Never in the store,
  // never in storage. (invariant §3)
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [phase, setPhase] = useState<Phase>('entry');
  const [smsCode, setSmsCode] = useState('');
  const [otpId, setOtpId] = useState<string | null>(null);
  const [activatesAt, setActivatesAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Clears the ENTRY state. Deliberately does NOT clear `otpId`: moving
  // into the reset screen is itself a prompt change, and clearing the id
  // here would throw away the one just obtained from
  // requestMoneyPinReset — leaving the confirm step with nothing to send.
  // The id's lifetime belongs to the reset flow, which sets it at the
  // start of every request and drops it when the flow ends.
  // Ends the whole interaction: answers the waiting caller and drops the
  // reset id, so a later prompt can never reuse a code from this one.
  const settle = useCallback(
    (ok: boolean) => {
      setOtpId(null);
      settleStore(ok);
    },
    [settleStore],
  );

  const reset = useCallback(() => {
    setPin('');
    setConfirmPin('');
    setPhase('entry');
    setSmsCode('');
    setActivatesAt(null);
    setBusy(false);
    setError(null);
  }, []);

  // Every time the prompt changes, start clean. Carrying digits from a
  // verify screen into an enrolment screen would be a way for the wrong
  // code to be submitted to the wrong endpoint.
  useEffect(() => {
    reset();
  }, [prompt, reset]);

  if (prompt === 'closed') return null;

  const codeToMessage = (code?: string): string => {
    switch (code) {
      case 'MONEY_PIN_INVALID':
        return t('moneyPin.wrongPin');
      case 'MONEY_PIN_LOCKED':
        return t('moneyPin.lockedShort');
      case 'MONEY_PIN_INVALID_FORMAT':
        return t('moneyPin.badFormat');
      case 'MONEY_PIN_ALREADY_SET':
        return t('moneyPin.alreadySet');
      case 'OTP_INVALID':
        return t('errors.otpInvalid');
      default:
        return t('moneyPin.genericError');
    }
  };

  // ── enrolment: choose, then confirm ─────────────────────────────────
  const submitEnroll = async (confirmed: string) => {
    if (confirmed !== pin) {
      setError(t('moneyPin.mismatch'));
      setConfirmPin('');
      setPhase('entry');
      setPin('');
      return;
    }
    setBusy(true);
    const result = await setMoneyPin(pin);
    setBusy(false);
    if (!result.ok) {
      setError(codeToMessage(result.code));
      setPin('');
      setConfirmPin('');
      setPhase('entry');
      return;
    }
    markStepUpOpen();
    settle(true);
  };

  const submitVerify = async (entered: string) => {
    setBusy(true);
    const result = await verifyMoneyPin(entered);
    setBusy(false);
    if (!result.ok) {
      setPin('');
      if (result.code === 'MONEY_PIN_LOCKED') {
        setPrompt('locked', result.lockedUntil ?? null);
        return;
      }
      setError(codeToMessage(result.code));
      return;
    }
    markStepUpOpen();
    settle(true);
  };

  const startReset = async () => {
    setBusy(true);
    setOtpId(null);
    const res = await requestMoneyPinReset();
    setBusy(false);
    if (!res) {
      setError(t('moneyPin.genericError'));
      return;
    }
    setOtpId(res.otpId);
    setPrompt('reset');
  };

  const submitReset = async (confirmed: string) => {
    if (!otpId) return;
    if (confirmed !== pin) {
      setError(t('moneyPin.mismatch'));
      setPin('');
      setConfirmPin('');
      setPhase('entry');
      return;
    }
    setBusy(true);
    const res = await confirmMoneyPinReset(otpId, smsCode, pin);
    setBusy(false);
    if (!res) {
      setError(codeToMessage('OTP_INVALID'));
      setSmsCode('');
      return;
    }
    // The screen does NOT close on success. The 24-hour explanation is
    // the whole point of the flow and a toast would be read by nobody:
    // the driver has just set a PIN that does not work yet, and if he
    // does not learn that here he learns it tomorrow at a money screen.
    setActivatesAt(res.activatesAt);
  };

  // A SLOT, not an overlay. No `fixed`, no `inset-0`, no backdrop, and
  // deliberately NOT role="dialog"/aria-modal — this is a region of the
  // page, and telling a screen reader it is a modal would be the same lie
  // the visual overlay used to tell the eye.
  //
  // `data-testid="money-pin-gate"` is kept: what it identifies (the money
  // prompt) has not changed, and every test and helper that finds the pad
  // by it still finds the pad.
  const shell = (title: string, body: React.ReactNode) => (
    <section
      className="w-full"
      role="group"
      aria-label={title}
      data-testid="money-pin-gate"
      data-prompt={prompt}
    >
      <h3 className="mb-2 text-center text-base font-semibold text-gray-900">{title}</h3>
      {body}
    </section>
  );

  if (prompt === 'locked') {
    const until = lockedUntil ? new Date(lockedUntil) : null;
    return shell(
      t('moneyPin.lockedTitle'),
      <div className="mx-auto max-w-sm space-y-6 text-center">
        <p className="text-gray-600" data-testid="money-pin-locked-body">
          {until
            ? t('moneyPin.lockedUntil', {
                time: until.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              })
            : t('moneyPin.lockedShort')}
        </p>
        <Button variant="secondary" fullWidth onClick={startReset} loading={busy}
          data-testid="money-pin-locked-reset">
          {t('moneyPin.forgotCta')}
        </Button>
        <Button variant="ghost" fullWidth onClick={() => settle(false)}
          data-testid="money-pin-locked-close">
          {t('common.close')}
        </Button>
      </div>,
    );
  }

  if (prompt === 'reset') {
    // Terminal state of the reset: the explanation, in plain words.
    if (activatesAt) {
      const when = new Date(activatesAt);
      return shell(
        t('moneyPin.resetDoneTitle'),
        <div className="mx-auto max-w-sm space-y-5 text-center">
          <p className="text-gray-700" data-testid="money-pin-reset-explain">
            {t('moneyPin.resetExplain', {
              time: when.toLocaleString([], {
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              }),
            })}
          </p>
          <p className="text-sm text-gray-500">{t('moneyPin.resetWhy')}</p>
          <p className="text-sm text-gray-500">{t('moneyPin.resetOldStillWorks')}</p>
          <Button fullWidth onClick={() => settle(false)} data-testid="money-pin-reset-done">
            {t('common.close')}
          </Button>
        </div>,
      );
    }

    return shell(
      t('moneyPin.resetTitle'),
      <div className="mx-auto max-w-sm space-y-6">
        <p className="text-center text-sm text-gray-600">{t('moneyPin.resetSmsSent')}</p>
        <label className="block">
          <span className="mb-1 block text-sm text-gray-700">{t('moneyPin.smsCodeLabel')}</span>
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={OTP_LENGTH}
            value={smsCode}
            onChange={(e) => setSmsCode(e.target.value.replace(/\D/g, ''))}
            data-testid="money-pin-reset-sms"
            className="w-full rounded-lg border border-gray-300 px-4 py-3 text-center text-xl tracking-[0.4em]"
          />
        </label>
        {smsCode.length === OTP_LENGTH && (
          <>
            <p className="text-center text-sm text-gray-700">
              {phase === 'entry' ? t('moneyPin.chooseNew') : t('moneyPin.confirmNew')}
            </p>
            <PinPad
              testIdPrefix="money-pin-reset"
              ariaLabel={t('moneyPin.padLabel')}
              length={MONEY_PIN_LENGTH}
              disabled={busy}
              value={phase === 'entry' ? pin : confirmPin}
              onChange={phase === 'entry' ? setPin : setConfirmPin}
              onComplete={(v) => {
                setError(null);
                if (phase === 'entry') setPhase('confirm');
                else void submitReset(v);
              }}
            />
          </>
        )}
        {error && (
          <p className="text-center text-sm text-[#C0392B]" role="alert" data-testid="money-pin-error">
            {error}
          </p>
        )}
        <Button variant="ghost" fullWidth onClick={() => settle(false)}>
          {t('common.cancel')}
        </Button>
      </div>,
    );
  }

  // ── enroll | verify ─────────────────────────────────────────────────
  const isEnroll = prompt === 'enroll';
  const value = phase === 'entry' ? pin : confirmPin;

  return shell(
    isEnroll ? t('moneyPin.enrollTitle') : t('moneyPin.verifyTitle'),
    <div className="mx-auto max-w-sm space-y-6">
      <p className="text-center text-sm text-gray-600" data-testid="money-pin-subtitle">
        {isEnroll
          ? phase === 'entry'
            ? t('moneyPin.enrollWhy')
            : t('moneyPin.confirmNew')
          : t('moneyPin.verifyWhy')}
      </p>

      <PinPad
        testIdPrefix="money-pin"
        ariaLabel={t('moneyPin.padLabel')}
        length={MONEY_PIN_LENGTH}
        disabled={busy}
        value={value}
        onChange={phase === 'entry' ? setPin : setConfirmPin}
        onComplete={(v) => {
          setError(null);
          if (!isEnroll) {
            void submitVerify(v);
            return;
          }
          if (phase === 'entry') setPhase('confirm');
          else void submitEnroll(v);
        }}
      />

      {error && (
        <p className="text-center text-sm text-[#C0392B]" role="alert" data-testid="money-pin-error">
          {error}
        </p>
      )}

      {!isEnroll && (
        <Button variant="ghost" fullWidth onClick={startReset} loading={busy}
          data-testid="money-pin-forgot">
          {t('moneyPin.forgotCta')}
        </Button>
      )}

      <Button
        variant="ghost"
        fullWidth
        onClick={() => settle(false)}
        data-testid="money-pin-dismiss"
      >
        {isEnroll ? t('moneyPin.notNow') : t('common.cancel')}
      </Button>
    </div>,
  );
};
