import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/Button';
import { PinPad } from './PinPad';
import { useUIStore } from '../../stores/ui.store';
import {
  fetchMoneyPinStatus,
  changeMoneyPin,
  MoneyPinStatus,
} from '../../lib/money-pin';
import { MONEY_PIN_LENGTH } from '@bimoto/shared';

// MONEY-PIN G3 — the Settings row.
//
// CHANGE, NOT RESET, and the difference is the whole design. This flow
// asks for the CURRENT PIN and applies the new one IMMEDIATELY. The
// 24-hour delay exists solely for a reset proven by SMS — that is,
// proven by possession of the handset, which is exactly what a borrower
// has. Someone who can type the live PIN has proven knowledge, which is
// strictly stronger, and making him wait a day for his own deliberate
// change would be friction that buys nothing.
//
// Driver-only, and rendered only when a PIN exists: a driver who has not
// enrolled yet is not nagged here. He meets the PIN at his first money
// screen, once, which is the ruling.

type Step = 'idle' | 'current' | 'new' | 'confirm';

export const MoneyPinSettingsSection: React.FC = () => {
  const { t } = useTranslation();
  const showToast = useUIStore((s) => s.showToast);

  const [status, setStatus] = useState<MoneyPinStatus | null>(null);
  const [step, setStep] = useState<Step>('idle');
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetchMoneyPinStatus().then(setStatus);
  }, []);

  const cancel = useCallback(() => {
    setStep('idle');
    setCurrentPin('');
    setNewPin('');
    setConfirmPin('');
  }, []);

  const submit = useCallback(
    async (confirmed: string) => {
      if (confirmed !== newPin) {
        showToast(t('moneyPin.mismatch'), 'error');
        setNewPin('');
        setConfirmPin('');
        setStep('new');
        return;
      }
      setBusy(true);
      const result = await changeMoneyPin(currentPin, newPin);
      setBusy(false);
      if (!result.ok) {
        showToast(
          result.code === 'MONEY_PIN_INVALID'
            ? t('moneyPin.wrongPin')
            : result.code === 'MONEY_PIN_LOCKED'
              ? t('moneyPin.lockedShort')
              : t('moneyPin.genericError'),
          'error',
        );
        cancel();
        return;
      }
      showToast(t('moneyPin.changed'), 'success');
      cancel();
      void fetchMoneyPinStatus().then(setStatus);
    },
    [currentPin, newPin, showToast, t, cancel],
  );

  // Nothing to change until there is a PIN to change.
  if (!status || status.state === 'NOT_SET') return null;

  return (
    <div className="bg-white rounded-xl shadow-sm p-4" data-testid="settings-money-pin">
      <h2 className="text-base font-semibold text-gray-900 mb-1">{t('moneyPin.settingsTitle')}</h2>
      <p className="text-sm text-gray-600 mb-3">{t('moneyPin.settingsHelp')}</p>

      {status.state === 'PENDING_RESET' && status.pendingActivatesAt && (
        // A reset is waiting out its window. Said here as well as by SMS,
        // because Settings is where someone who suspects something goes
        // to look — and this is the screen on which he can stop it, by
        // changing the PIN with the one he still knows.
        <p
          className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900"
          data-testid="settings-money-pin-pending"
        >
          {t('moneyPin.pendingWarning', {
            time: new Date(status.pendingActivatesAt).toLocaleString([], {
              day: '2-digit',
              month: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            }),
          })}
        </p>
      )}

      {step === 'idle' ? (
        <Button
          variant="secondary"
          onClick={() => setStep('current')}
          data-testid="settings-money-pin-change"
        >
          {t('moneyPin.changeCta')}
        </Button>
      ) : (
        <div className="space-y-4">
          <p className="text-center text-sm text-gray-700" data-testid="settings-money-pin-step">
            {step === 'current'
              ? t('moneyPin.enterCurrent')
              : step === 'new'
                ? t('moneyPin.chooseNew')
                : t('moneyPin.confirmNew')}
          </p>
          <PinPad
            testIdPrefix="settings-money-pin"
            ariaLabel={t('moneyPin.padLabel')}
            length={MONEY_PIN_LENGTH}
            disabled={busy}
            value={step === 'current' ? currentPin : step === 'new' ? newPin : confirmPin}
            onChange={
              step === 'current' ? setCurrentPin : step === 'new' ? setNewPin : setConfirmPin
            }
            onComplete={(v) => {
              if (step === 'current') setStep('new');
              else if (step === 'new') setStep('confirm');
              else void submit(v);
            }}
          />
          <Button variant="ghost" fullWidth onClick={cancel}>
            {t('common.cancel')}
          </Button>
        </div>
      )}
    </div>
  );
};
