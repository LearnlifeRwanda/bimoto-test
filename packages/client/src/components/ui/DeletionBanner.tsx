// ACCOUNT-RIGHTS-SURFACE G2 — the countdown that follows you, and the way
// out that follows you with it.
//
// Founder ruling: the deletion ENTRY is deliberately buried (Settings, at
// the very bottom, behind two screens). The cancel is deliberately not.
// Changing your mind must never be the hard path, so this banner mounts at
// the shell beside <SimulationBanner />, which means it renders on every
// routed screen — and its cancel button is therefore one tap away from
// wherever the person happens to be when they think better of it.
//
// It renders from STORE STATE ONLY. `user.accountDeletion` arrives with
// every GET /me — boot restore, login, each profile refetch — so there is
// no poll and no socket here. The only timer is a local one-minute tick
// that re-renders the countdown text; it does not fetch anything.
//
// Three states, and the third is the one that made this group necessary:
//   before executesAt  — countdown + the D1 sentence + cancel
//   after, no reason   — the neutral "waiting" heading + cancel
//   after, with reason — the reason's plain-language sentence + cancel
// Without the third, a deletion the job keeps deferring counts down to
// zero and then sits there, silently, looking like the app forgot.

import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MS_PER_DAY } from '@bimoto/shared';
import { useAuthStore } from '../../stores/auth.store';
import { useUIStore } from '../../stores/ui.store';
import { apiFetch, apiErrorFromResponse } from '../../lib/api';
import { presentApiError } from '../../lib/api-error-presenter';
import { deferralReasonKey } from '../../lib/deletion-deferral';

/** How often the countdown text is recomputed. Coarse units, coarse tick:
 *  nothing on screen changes faster than once a minute. Derived from the
 *  shared day so the three units cannot drift apart, and so this file
 *  declares no time constant the literal-drift guard has already named. */
const DELETION_COUNTDOWN_HOUR_MS = MS_PER_DAY / 24;
const DELETION_COUNTDOWN_MINUTE_MS = DELETION_COUNTDOWN_HOUR_MS / 60;
const DELETION_COUNTDOWN_TICK_MS = DELETION_COUNTDOWN_MINUTE_MS;

/**
 * The countdown sentence for a remaining duration, as a translation key
 * plus its count. One unit — the largest that applies — because i18next
 * cannot pluralise two counts in one key and joining fragments does not
 * survive translation into Kinyarwanda.
 *
 * Exported for the test, which walks the boundaries rather than trusting
 * the arithmetic by eye.
 */
export function countdownKey(remainingMs: number): { key: string; count: number } | null {
  if (remainingMs <= 0) return null;
  if (remainingMs >= MS_PER_DAY) {
    return { key: 'deletion.bannerCountdownDays', count: Math.floor(remainingMs / MS_PER_DAY) };
  }
  if (remainingMs >= DELETION_COUNTDOWN_HOUR_MS) {
    return { key: 'deletion.bannerCountdownHours', count: Math.floor(remainingMs / DELETION_COUNTDOWN_HOUR_MS) };
  }
  if (remainingMs >= DELETION_COUNTDOWN_MINUTE_MS) {
    return {
      key: 'deletion.bannerCountdownMinutes',
      count: Math.floor(remainingMs / DELETION_COUNTDOWN_MINUTE_MS),
    };
  }
  return { key: 'deletion.bannerCountdownImminent', count: 0 };
}

export const DeletionBanner: React.FC = () => {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const showToast = useUIStore((s) => s.showToast);
  const [cancelling, setCancelling] = useState(false);
  // The in-flight guard has to be a REF, not the state above. Two taps in
  // the same tick both read the state from the SAME render's closure —
  // still false for the second one — and both fire. The second POST finds
  // no PENDING row, answers 404, and the presenter shows an error to
  // someone whose cancel had in fact just worked. The `disabled` attribute
  // alone does not close this: it is applied on the next render, which is
  // after both taps have already been handled.
  const cancelInFlight = useRef(false);
  const [now, setNow] = useState(() => Date.now());

  const deletion = user?.accountDeletion ?? null;

  // The tick exists only while a banner is actually on screen, and stops
  // the moment the deletion is cancelled or the user signs out.
  useEffect(() => {
    if (!deletion) return;
    const id = setInterval(() => setNow(Date.now()), DELETION_COUNTDOWN_TICK_MS);
    return () => clearInterval(id);
  }, [deletion]);

  if (!deletion) return null;

  const executesAt = new Date(deletion.executesAt).getTime();
  const remaining = Number.isNaN(executesAt) ? 0 : executesAt - now;
  const countdown = countdownKey(remaining);
  const reasonKey = deferralReasonKey(deletion.deferredReason);

  const cancel = async () => {
    if (cancelInFlight.current) return;
    cancelInFlight.current = true;
    setCancelling(true);
    try {
      const res = await apiFetch('/api/users/me/deletion/cancel', {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw await apiErrorFromResponse(res);

      // Refetch rather than patch: /me is the authority on the whole user
      // shape, and the cancel may have changed nothing else — but reading
      // it back is how this banner learns it should be gone, through the
      // same path every other consumer of the user object uses.
      const me = await apiFetch('/api/users/me');
      if (me.ok) {
        const data = await me.json();
        setUser((data as { user?: unknown })?.user ?? data);
      } else if (user) {
        // The cancel committed; only the read-back failed. Clear the field
        // locally so the banner goes, rather than leaving a countdown up
        // for a deletion the server has already cancelled.
        setUser({ ...user, accountDeletion: null });
      }
      showToast(t('deletion.bannerCancelled'), 'success');
    } catch (err) {
      presentApiError(err);
    } finally {
      cancelInFlight.current = false;
      setCancelling(false);
    }
  };

  return (
    <div
      role="status"
      data-testid="deletion-banner"
      className="sticky top-0 z-50 flex flex-col gap-1.5 bg-[#7B241C] px-3 py-2 text-xs text-white"
    >
      <span className="font-semibold" data-testid="deletion-banner-title">
        {reasonKey || !countdown ? t('deletion.bannerDeferredTitle') : t('deletion.bannerTitle')}
      </span>

      {countdown && !reasonKey && (
        <span data-testid="deletion-banner-countdown">
          {t(countdown.key, { count: countdown.count })}
        </span>
      )}

      {reasonKey && <span data-testid="deletion-banner-reason">{t(reasonKey)}</span>}

      {countdown && !reasonKey && (
        <span className="text-white/80" data-testid="deletion-banner-rides-note">
          {t('deletion.bannerRidesNote')}
        </span>
      )}

      <button
        type="button"
        data-testid="deletion-banner-cancel"
        onClick={() => void cancel()}
        disabled={cancelling}
        className="mt-0.5 min-h-[44px] self-start rounded-lg bg-white px-4 font-semibold text-[#7B241C] disabled:opacity-60"
      >
        {cancelling ? t('deletion.bannerCancelPending') : t('deletion.bannerCancel')}
      </button>
    </div>
  );
};
