// COMPONENTS/LAYOUT/BACK-CONTROL.TSX
//
// APP-HEADER G2 — the header's back affordance. Supersedes BackToHome
// (PILOT-UX-2 G4), which only three of the 44 page files ever mounted;
// the other 41 — Profile among them, which is the field report — had
// no in-app way back at all.
//
// BEHAVIOUR: true history-back, with a home fallback.
//
// The choice is forced by consistency with the hardware Back button
// wired in PROFILE-RESCUE G4 (#140). That handler already does
// navigate(-1), so a header control that jumped to home instead would
// give a phone two "back" gestures with two different destinations —
// exactly the confusion this dispatch is meant to remove. History-back
// is also the only behaviour that survives a deep flow: from
// /journey/:id/chat, home-back discards the whole journey context,
// while history-back returns to the matched screen the user came from.
//
// NO-HISTORY CASE: a screen opened cold — a push deep link, a pasted
// URL, an app relaunch — has nothing to go back to, and navigate(-1)
// there either does nothing or escapes the app. shouldNavigateBack()
// (exported by useAndroidBackButton, so both back gestures read the
// same predicate) detects it: react-router keys the initial history
// entry 'default' and every navigated-to entry gets a generated key.
// On that entry the control replaces into the role's home instead —
// the old BackToHome destination — so it can never dead-end.
//
// Router redirects do not pollute this: every guard in App.tsx uses
// <Navigate replace>, so a bounce through /login or /consent leaves no
// entry to land back on.

import React from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth.store';
import { shouldNavigateBack } from '../../hooks/useAndroidBackButton';

/**
 * The screens that ARE a destination rather than a step: the customer
 * home and the driver dashboard, each the first tab of its role's
 * BottomNav. They show no back control. Exported for the route walk in
 * the G3 test.
 */
export const HOME_PATHS = ['/', '/driver'];

export const BackControl: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const role = useAuthStore((s) => s.user?.role);

  if (HOME_PATHS.includes(location.pathname)) return null;

  const handleBack = () => {
    if (shouldNavigateBack(location)) {
      navigate(-1);
      return;
    }
    // Cold entry — send the user to their own home. A DRIVER's home is
    // the dashboard; '/' is not even in that role's nav.
    return role === 'DRIVER'
      ? navigate('/driver', { replace: true })
      : navigate('/', { replace: true });
  };

  return (
    <button
      type="button"
      data-testid="header-back"
      onClick={handleBack}
      className="-ml-1 inline-flex items-center gap-1.5 min-h-[44px] px-2 text-sm font-medium text-[#1B4F72] hover:text-[#164060] transition-colors"
    >
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
      </svg>
      {t('common.goBack')}
    </button>
  );
};

export default BackControl;
