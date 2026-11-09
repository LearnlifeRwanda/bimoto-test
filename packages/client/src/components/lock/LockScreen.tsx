import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PinPad } from '../money/PinPad';
import { Button } from '../ui/Button';
import { EmergencySOS } from '../safety/EmergencySOS';
import { useAppLockStore } from '../../stores/app-lock.store';
import { useJourneyStore } from '../../stores/journey.store';
import { verifyAppLockCode } from '../../lib/app-lock';
import { performLogout } from '../../lib/logout';
import { APP_LOCK_MIN_LENGTH, APP_LOCK_MAX_LENGTH } from '@bimoto/shared';

// APP-LOCK G4 — the screen that covers everything.
//
// THE PIERCE, AND EXACTLY WHAT IT COSTS.
//
// A lock that can stop someone calling for help in an emergency is not a
// safety feature, it is a hazard. So two things reach through it:
//
//   tel:112 — ALWAYS. Zero auth, zero data, no journey needed, no
//     network needed. It is an <a href> the OS dials; this component
//     could be entirely broken and the link would still work. Rendered
//     FIRST and above the pad, matching what EmergencySOS already does
//     with 112 during its own countdown.
//
//   EmergencySOS — ONLY when a journey is actually live. It is
//     journey-scoped by construction (it takes a journeyId, and the
//     endpoint gates on participation), so with no active journey there
//     is nothing it could raise. Mounting it anyway would render a red
//     button that fails.
//
// AND HERE IS THE INVARIANT THE PIERCE IS BUILT AROUND: neither of them
// changes what is reachable behind the lock. There is no unlock on this
// path, no partial unlock, no "emergency mode" that reveals a screen.
// SOS posts to the server and the lock screen stays exactly where it is —
// the store has no bypass function to call. So the pierce exposes the
// ability to CALL FOR HELP and nothing else, by construction rather than
// by care.
//
// D26: NO BIOMETRICS. There is no fingerprint prompt, no face prompt, no
// fallback to one. A number you know, or logging out.

export const LockScreen: React.FC = () => {
  const { t } = useTranslation();
  const unlock = useAppLockStore((s) => s.unlock);
  const activeJourney = useJourneyStore((s) => s.activeJourney);

  const [code, setCode] = useState('');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const submit = useCallback(async () => {
    setBusy(true);
    const ok = await verifyAppLockCode(code);
    setBusy(false);
    if (ok) {
      unlock();
      return;
    }
    setError(true);
    setCode('');
  }, [code, unlock]);

  // An active journey is the only condition. `activeJourney?.id` being
  // present IS "a journey exists to raise an alert on" — the same fact
  // the endpoint checks server-side.
  const journeyId: string | undefined = activeJourney?.id;

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-white"
      role="dialog"
      aria-modal="true"
      aria-label={t('appLock.title')}
      data-testid="lock-screen"
    >
      <div className="flex-1 overflow-y-auto px-6 pb-10 pt-10">
        {/*
          112 FIRST, above the fold, in every state. Not behind a
          disclosure, not below the pad, not conditional on anything.
        */}
        <a
          href="tel:112"
          data-testid="lock-screen-112"
          className="mb-8 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-[#C0392B] px-4 py-4 text-lg font-semibold text-[#C0392B]"
        >
          {t('appLock.call112')}
        </a>

        {journeyId && (
          <div className="mb-8" data-testid="lock-screen-sos">
            <p className="mb-2 text-center text-sm text-gray-600">
              {t('appLock.sosOnRide')}
            </p>
            <EmergencySOS journeyId={journeyId} />
          </div>
        )}

        <h1 className="mb-2 text-center text-xl font-semibold text-gray-900">
          {t('appLock.title')}
        </h1>
        <p className="mb-6 text-center text-sm text-gray-600">{t('appLock.subtitle')}</p>

        <PinPad
          testIdPrefix="app-lock"
          ariaLabel={t('appLock.padLabel')}
          // Dots show progress against the MINIMUM, while `maxLength`
          // lets the code run longer. Drawing the TRUE length would tell
          // a shoulder-surfer how many digits to guess, so it does not.
          length={APP_LOCK_MIN_LENGTH}
          maxLength={APP_LOCK_MAX_LENGTH}
          disabled={busy}
          value={code}
          onChange={(next) => {
            setError(false);
            setCode(next);
          }}
        />

        {error && (
          <p
            className="mt-4 text-center text-sm text-[#C0392B]"
            role="alert"
            data-testid="lock-screen-error"
          >
            {t('appLock.wrongCode')}
          </p>
        )}

        <div className="mx-auto mt-6 max-w-sm">
          <Button
            fullWidth
            loading={busy}
            disabled={code.length < APP_LOCK_MIN_LENGTH}
            onClick={submit}
            data-testid="lock-screen-unlock"
          >
            {t('appLock.unlock')}
          </Button>
          {/*
            THE WAY OUT FOR SOMEONE WHO FORGOT, and it has to be HERE.
            D25's recovery path is "log out, then log in with an SMS OTP"
            — but logout lives in Settings, which is behind this screen.
            Without this button the recovery path would be unreachable
            from the only screen that needs it, and a forgotten code would
            mean reinstalling the app.

            IT DOES NOT VIOLATE THE PINNED INVARIANT. The rule is that no
            lock-screen action changes what is REACHABLE behind the lock.
            Logging out makes strictly LESS reachable, not more: it
            destroys the session, disarms the lock, and lands on the login
            screen, where the next person needs an SMS code to this phone
            number. Nothing that was behind the lock is revealed by it —
            the account is simply no longer open on this device.
          */}
          <p className="mt-6 text-center text-xs text-gray-500">
            {t('appLock.forgotHelp')}
          </p>
          <Button
            variant="ghost"
            fullWidth
            loading={loggingOut}
            onClick={async () => {
              setLoggingOut(true);
              await performLogout();
              // disarmAppLock inside performLogout clears the code, and
              // setArmed(false) drops `locked` with it, so this screen
              // unmounts and the router renders /login.
              setLoggingOut(false);
            }}
            data-testid="lock-screen-logout"
          >
            {t('appLock.logoutCta')}
          </Button>
        </div>
      </div>
    </div>
  );
};
