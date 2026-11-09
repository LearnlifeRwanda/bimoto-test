// ACCOUNT-RIGHTS-SURFACE G2 — the buried door, and the two rooms behind it.
//
// Founder ruling (Faustin, 20 Aug): deletion must be hard to find, take
// more than one step, warn plainly, and say what is KEPT. This page is the
// second and third of those. The first is where it is reached from — the
// last row of Settings, below the logout button, with no link from home,
// no nav entry, and no search.
//
// Step 1 is not a legal notice, it is an answer to the question people
// actually have: what disappears, what does not, and why not. The kept
// list mirrors docs/data-retention.md in plain words — the ride happened,
// other people were on it, the law requires the record, and none of it
// carries your name afterwards.
//
// Step 2 is the gate. NOT a bare button: a press-and-hold, held for two
// seconds. There is no press-and-hold anywhere else in this repo and no
// typed-word confirm either, so neither was "repo-consistent"; the hold
// wins because a typed word has to be typed in SOME language, and asking a
// motari to spell an English word before he can exercise a data right is
// the opposite of the point. A hold is language-free, thumb-friendly, and
// physically hard to do by accident. Keyboard users get the same gate via
// Enter/Space held down, so the control is not pointer-only.
//
// The DELETE fires from the hold completing and from nothing else.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { apiFetch, apiErrorFromResponse } from '../../lib/api';
import { presentApiError } from '../../lib/api-error-presenter';
import { useAuthStore } from '../../stores/auth.store';

/** How long the confirm button must be held. Long enough to be deliberate,
 *  short enough not to feel like a punishment. */
const CONFIRM_HOLD_MS = 2000;

export const DeleteAccountPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);

  const [step, setStep] = useState<1 | 2>(1);
  const [holding, setHolding] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ref, not the state above, for the same reason the banner's cancel
  // guard is one: a second hold that completes while the first DELETE is
  // still in flight reads `submitting` from a stale closure. One request
  // per screen, and 409 deletionAlreadyPending is the server's backstop.
  const submitInFlight = useRef(false);

  const clearHold = useCallback(() => {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    setHolding(false);
  }, []);

  // A hold interrupted by an unmount (back button mid-press) must not fire
  // a deletion at a user who has left the screen.
  useEffect(() => clearHold, [clearHold]);

  const requestDeletion = useCallback(async () => {
    setHolding(false);
    if (submitInFlight.current) return;
    submitInFlight.current = true;
    setSubmitting(true);
    try {
      const res = await apiFetch('/api/users/me', {
        method: 'DELETE',
        credentials: 'include',
      });
      // 409 errors.deletionAlreadyPending lands here and renders through
      // the shared presenter, which resolves the server's own message key
      // in the user's language — no client-side copy of the refusal text.
      if (!res.ok) throw await apiErrorFromResponse(res);

      const body = (await res.json()) as { executesAt?: string };
      if (user && body.executesAt) {
        // Patch the store so the shell banner is up before the navigation
        // lands. The next GET /me confirms it from the server.
        setUser({
          ...user,
          accountDeletion: {
            requestedAt: new Date().toISOString(),
            executesAt: body.executesAt,
            deferredReason: null,
          },
        });
      }
      navigate('/', { replace: true });
    } catch (err) {
      presentApiError(err);
    } finally {
      submitInFlight.current = false;
      setSubmitting(false);
    }
  }, [navigate, setUser, user]);

  const startHold = useCallback(() => {
    if (submitInFlight.current || holdTimer.current) return;
    setHolding(true);
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null;
      void requestDeletion();
    }, CONFIRM_HOLD_MS);
  }, [requestDeletion]);

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-6">
      <div className="w-full max-w-sm mx-auto space-y-5">
        <h1 className="text-xl font-bold text-[#7B241C]">
          {step === 1 ? t('deletion.step1Title') : t('deletion.step2Title')}
        </h1>

        {step === 1 ? (
          <div data-testid="delete-account-step-1" className="space-y-4">
            <p className="text-sm text-gray-700">{t('deletion.step1Intro')}</p>

            <div className="bg-white rounded-xl shadow-sm p-4">
              <h2 className="text-base font-semibold text-gray-900 mb-2">
                {t('deletion.step1ErasedTitle')}
              </h2>
              <ul className="space-y-1.5 text-sm text-gray-700">
                {[
                  'deletion.step1ErasedPhone',
                  'deletion.step1ErasedName',
                  'deletion.step1ErasedContacts',
                  'deletion.step1ErasedDocuments',
                ].map((key) => (
                  <li key={key} className="flex gap-2">
                    <span aria-hidden>•</span>
                    <span>{t(key)}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="bg-white rounded-xl shadow-sm p-4">
              <h2 className="text-base font-semibold text-gray-900 mb-2">
                {t('deletion.step1KeptTitle')}
              </h2>
              <ul className="space-y-1.5 text-sm text-gray-700">
                {[
                  'deletion.step1KeptRides',
                  'deletion.step1KeptPayments',
                  'deletion.step1KeptSafety',
                ].map((key) => (
                  <li key={key} className="flex gap-2">
                    <span aria-hidden>•</span>
                    <span>{t(key)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-sm text-gray-600">{t('deletion.step1KeptWhy')}</p>
            </div>

            <p className="text-sm text-gray-700">{t('deletion.step1Window')}</p>

            <Button
              fullWidth
              variant="danger"
              data-testid="delete-account-continue"
              onClick={() => setStep(2)}
            >
              {t('deletion.step1Continue')}
            </Button>
            <Button fullWidth variant="secondary" onClick={() => navigate('/settings')}>
              {t('deletion.step1Back')}
            </Button>
          </div>
        ) : (
          <div data-testid="delete-account-step-2" className="space-y-4">
            <div className="bg-white rounded-xl shadow-sm p-4">
              <p className="text-sm text-gray-800">{t('deletion.step2Warning')}</p>
            </div>

            <p className="text-sm text-gray-700">{t('deletion.step2HoldInstruction')}</p>

            <button
              type="button"
              data-testid="delete-account-hold"
              disabled={submitting}
              onPointerDown={startHold}
              onPointerUp={clearHold}
              onPointerLeave={clearHold}
              onPointerCancel={clearHold}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  startHold();
                }
              }}
              onKeyUp={clearHold}
              onBlur={clearHold}
              className={`min-h-[52px] w-full rounded-lg font-semibold text-white transition-colors ${
                holding ? 'bg-[#5A1A15]' : 'bg-[#7B241C]'
              } disabled:opacity-60`}
            >
              {submitting
                ? t('deletion.step2Submitting')
                : holding
                  ? t('deletion.step2Holding')
                  : t('deletion.step2Hold')}
            </button>

            <Button
              fullWidth
              variant="secondary"
              data-testid="delete-account-abort"
              onClick={() => {
                clearHold();
                navigate('/settings');
              }}
            >
              {t('deletion.step2Back')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default DeleteAccountPage;
