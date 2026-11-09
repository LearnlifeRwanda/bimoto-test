import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/Button';
import { PinPad } from '../money/PinPad';
import { useUIStore } from '../../stores/ui.store';
import { useAppLockStore } from '../../stores/app-lock.store';
import {
  armAppLock,
  disarmAppLock,
  verifyAppLockCode,
  isAppLockArmed,
  getAppLockTimeout,
  setAppLockTimeout,
  APP_LOCK_TIMEOUT_OPTIONS,
  AppLockTimeout,
  CodeRejection,
  validateAppLockCode,
} from '../../lib/app-lock';
import { APP_LOCK_MIN_LENGTH, APP_LOCK_MAX_LENGTH } from '@bimoto/shared';

// APP-LOCK G4 — the Settings section.
//
// DEFAULT OFF, FOR EVERYONE (ruling D25). Drivers see one recommending
// line; nobody is opted in, and the line is dismissible and does not
// return — a nag is how a security suggestion becomes something people
// learn to tap past without reading.
//
// ENABLING ASKS TWICE (choose, confirm), because a mistyped code that is
// only entered once locks the owner out of his own app until he logs out.
// DISABLING asks for the code, so that handing someone a phone that is
// merely unlocked does not also hand them the ability to remove the lock.

type Mode = 'idle' | 'enable' | 'confirm' | 'disable';

/** Remembered per device; a dismissed suggestion stays dismissed. */
const RECOMMEND_DISMISSED_KEY = 'bimoto.appLock.recommendDismissed';

export const AppLockSettingsSection: React.FC<{ isDriver: boolean }> = ({ isDriver }) => {
  const { t } = useTranslation();
  const showToast = useUIStore((s) => s.showToast);
  const setArmedInStore = useAppLockStore((s) => s.setArmed);

  const [armed, setArmed] = useState(false);
  const [timeout, setTimeoutMinutes] = useState<AppLockTimeout>(0);
  const [mode, setMode] = useState<Mode>('idle');
  const [code, setCode] = useState('');
  const [confirmCode, setConfirmCode] = useState('');
  const [rejection, setRejection] = useState<CodeRejection | null>(null);
  const [busy, setBusy] = useState(false);
  const [recommendDismissed, setRecommendDismissed] = useState(true);

  useEffect(() => {
    void (async () => {
      const isArmed = await isAppLockArmed();
      setArmed(isArmed);
      if (isArmed) setTimeoutMinutes(await getAppLockTimeout());
      try {
        setRecommendDismissed(localStorage.getItem(RECOMMEND_DISMISSED_KEY) === '1');
      } catch {
        // Private mode / storage disabled — treat as dismissed rather
        // than showing the line on every visit.
        setRecommendDismissed(true);
      }
    })();
  }, []);

  const cancel = useCallback(() => {
    setMode('idle');
    setCode('');
    setConfirmCode('');
    setRejection(null);
  }, []);

  const rejectionMessage = (r: CodeRejection): string => {
    switch (r) {
      case 'LOOKS_LIKE_MONEY_PIN':
        return t('appLock.rejectMoneyPinLength', { min: APP_LOCK_MIN_LENGTH });
      case 'TOO_SHORT':
        return t('appLock.rejectTooShort', { min: APP_LOCK_MIN_LENGTH });
      default:
        return t('appLock.rejectNotDigits');
    }
  };

  const enable = useCallback(async () => {
    if (code !== confirmCode) {
      showToast(t('appLock.mismatch'), 'error');
      setCode('');
      setConfirmCode('');
      setMode('enable');
      return;
    }
    setBusy(true);
    const result = await armAppLock(code);
    setBusy(false);
    if (result) {
      setRejection(result);
      setCode('');
      setConfirmCode('');
      setMode('enable');
      return;
    }
    await setAppLockTimeout(timeout);
    setArmed(true);
    // The store is told, but NOT locked — the person configuring it is
    // demonstrably present. It takes effect at the next cold start.
    setArmedInStore(true, timeout);
    useAppLockStore.getState().unlock();
    showToast(t('appLock.enabled'), 'success');
    cancel();
  }, [code, confirmCode, timeout, showToast, t, cancel, setArmedInStore]);

  const disable = useCallback(async () => {
    setBusy(true);
    const ok = await verifyAppLockCode(code);
    if (!ok) {
      setBusy(false);
      showToast(t('appLock.wrongCode'), 'error');
      setCode('');
      return;
    }
    await disarmAppLock();
    setBusy(false);
    setArmed(false);
    setTimeoutMinutes(0);
    setArmedInStore(false, 0);
    showToast(t('appLock.disabled'), 'success');
    cancel();
  }, [code, showToast, t, cancel, setArmedInStore]);

  const dismissRecommend = () => {
    setRecommendDismissed(true);
    try {
      localStorage.setItem(RECOMMEND_DISMISSED_KEY, '1');
    } catch {
      // Nothing to do — the line simply reappears next visit.
    }
  };

  const changeTimeout = async (minutes: AppLockTimeout) => {
    setTimeoutMinutes(minutes);
    await setAppLockTimeout(minutes);
    setArmedInStore(true, minutes);
    useAppLockStore.getState().unlock();
  };

  return (
    <div className="bg-white rounded-xl shadow-sm p-4" data-testid="settings-app-lock">
      <h2 className="text-base font-semibold text-gray-900 mb-1">{t('appLock.settingsTitle')}</h2>
      <p className="text-sm text-gray-600 mb-3">{t('appLock.settingsHelp')}</p>

      {isDriver && !armed && !recommendDismissed && (
        <div
          className="mb-3 flex items-start gap-2 rounded-lg bg-blue-50 p-3"
          data-testid="app-lock-recommend"
        >
          <p className="flex-1 text-sm text-blue-900">{t('appLock.recommendDriver')}</p>
          <button
            type="button"
            onClick={dismissRecommend}
            aria-label={t('common.dismiss')}
            data-testid="app-lock-recommend-dismiss"
            className="text-blue-900"
          >
            ✕
          </button>
        </div>
      )}

      {mode === 'idle' && (
        <div className="space-y-3">
          <Button
            variant={armed ? 'secondary' : 'primary'}
            onClick={() => {
              setMode(armed ? 'disable' : 'enable');
              setRejection(null);
            }}
            data-testid={armed ? 'app-lock-disable' : 'app-lock-enable'}
          >
            {armed ? t('appLock.disableCta') : t('appLock.enableCta')}
          </Button>

          {armed && (
            <div data-testid="app-lock-timeout">
              <p className="mb-2 text-sm text-gray-700">{t('appLock.timeoutLabel')}</p>
              <div className="flex flex-wrap gap-2">
                {APP_LOCK_TIMEOUT_OPTIONS.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => void changeTimeout(opt)}
                    data-testid={`app-lock-timeout-${opt}`}
                    aria-pressed={timeout === opt}
                    className={`rounded-lg border px-3 py-2 text-sm ${
                      timeout === opt
                        ? 'border-[#1B4F72] bg-[#1B4F72] text-white'
                        : 'border-gray-300 text-gray-700'
                    }`}
                  >
                    {opt === 0 ? t('appLock.timeoutOff') : t('appLock.timeoutMinutes', { count: opt })}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-gray-500">{t('appLock.timeoutHelp')}</p>
            </div>
          )}
        </div>
      )}

      {mode !== 'idle' && (
        <div className="space-y-4">
          <p className="text-center text-sm text-gray-700" data-testid="app-lock-step">
            {mode === 'enable'
              ? t('appLock.chooseCode', { min: APP_LOCK_MIN_LENGTH })
              : mode === 'confirm'
                ? t('appLock.confirmCode')
                : t('appLock.enterCodeToDisable')}
          </p>

          <PinPad
            testIdPrefix="app-lock-setup"
            ariaLabel={t('appLock.padLabel')}
            length={APP_LOCK_MIN_LENGTH}
            maxLength={APP_LOCK_MAX_LENGTH}
            disabled={busy}
            value={mode === 'confirm' ? confirmCode : code}
            onChange={mode === 'confirm' ? setConfirmCode : setCode}
          />

          {rejection && (
            <p
              className="text-center text-sm text-[#C0392B]"
              role="alert"
              data-testid="app-lock-reject"
            >
              {rejectionMessage(rejection)}
            </p>
          )}
          {mode === 'enable' && !rejection && (
            // The format rule is stated BEFORE it is broken. "At least six
            // digits, and not the same four as your money PIN" is a rule a
            // user can follow; discovering it by refusal reads as a bug.
            <p className="text-center text-xs text-gray-500" data-testid="app-lock-format-help">
              {t('appLock.formatHelp', { min: APP_LOCK_MIN_LENGTH })}
            </p>
          )}

          <Button
            fullWidth
            loading={busy}
            disabled={
              (mode === 'confirm' ? confirmCode : code).length < APP_LOCK_MIN_LENGTH
            }
            onClick={() => {
              if (mode === 'enable') {
                // Shape is checked BEFORE the confirm step, so a user who
                // typed four digits is told why immediately instead of
                // typing them twice and then being refused.
                const r = validateAppLockCode(code);
                setRejection(r);
                if (r) {
                  setCode('');
                  return;
                }
                setMode('confirm');
                return;
              }
              if (mode === 'confirm') void enable();
              else void disable();
            }}
            data-testid="app-lock-submit"
          >
            {t('common.confirm')}
          </Button>
          <Button variant="ghost" fullWidth onClick={cancel}>
            {t('common.cancel')}
          </Button>
        </div>
      )}
    </div>
  );
};
