// COMPONENTS/LAYOUT/APP-HEADER.TSX
//
// APP-HEADER G1 — the shell's top chrome band. Until this component
// there was nothing above <main> but the three conditional strips, so
// no screen inside the app carried the Bimoto mark (#142 could brand
// the launcher, splash, favicon and theme colour but had nowhere to
// put the mark *inside* the app).
//
// Layout contract:
//   - normal document flow, first child of the shell's flex column, so
//     <main> keeps its existing padding (a *fixed* header would have
//     needed a symmetric pt-* on <main>; an in-flow one does not);
//   - it owns the top safe area (pt-[env(safe-area-inset-top)]),
//     symmetric to BottomNav's pb-[env(safe-area-inset-bottom)], so
//     nothing renders under a phone's status bar;
//   - the mark is anchored RIGHT and the back control LEFT.
//
// CHROME-C G2 — the header now also carries the connection.
//
// The four transient strips are gone from the shell. What they said
// ambiently — connected, syncing, offline, no server — is one pill
// here, next to the back control, swapping in place. What they said
// about events is a toast plus the pill's badge, and the long form of
// all of it is one tap away in StatusDetailSheet. The header is
// therefore the only chrome above <main>, in every state, which is the
// whole of Option C: content never moves and nothing covers it unless
// the user asked.
//
// THE WASH. One state — and only one — is allowed to change this bar's
// own colour: `noServer`. A server we cannot reach is the one condition
// where a red pill alone can be missed, and the founder's ladder
// reserves the wash for it. Being offline is deliberately NOT washed:
// it is normal in Kigali and the app is built for it.
//
// Brand blue (#1340A7) enters the app only as the mark's own artwork —
// the in-app UI palette (#1B4F72 and friends) is unchanged. The wash's
// values (#FCEBEB / #F7C1C1 / #791F1F) are the §0 colour table's, and
// they replace the bar's white/grey while it is up.

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import markUrl from '../../assets/brand/BiMoto-mark.svg';
import { useAuthStore } from '../../stores/auth.store';
import { roleHomePath } from '../../lib/role-home';
import { BackControl } from './BackControl';
import {
  ConnectionStatus,
  useHeaderStatus,
  statusWashesHeader,
} from './ConnectionStatus';
import { StatusDetailSheet } from './StatusDetailSheet';

export const AppHeader: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const role = useAuthStore((s) => s.user?.role);
  const [detailOpen, setDetailOpen] = useState(false);
  const status = useHeaderStatus();
  const washed = statusWashesHeader(status);

  // The mark is the home affordance every platform has trained users to
  // expect. roleHomePath is the same seam login lands on, so the logo
  // and the login redirect can never disagree about where "home" is —
  // an ANALYST tapping it gets /intel, not a customer's ride screen.
  const home = roleHomePath(role);
  const goHome = () => {
    // Already there: a no-op tap must not push a duplicate entry, or
    // the next Back gesture would appear to do nothing.
    if (location.pathname === home) return;
    navigate(home);
  };

  return (
    <header
      className={`w-full border-b pt-[env(safe-area-inset-top)] transition-colors duration-300 ${
        washed
          ? 'bg-[#FCEBEB] border-[#F7C1C1] text-[#791F1F]'
          : 'bg-white border-gray-200'
      }`}
      data-testid="app-header"
      data-washed={washed ? 'true' : 'false'}
      aria-label={t('layout.appHeader')}
    >
      <div className="flex h-12 items-center gap-2 px-2">
        <BackControl />
        <ConnectionStatus onOpenDetail={() => setDetailOpen(true)} />
        {/* ml-auto, not justify-between alone: on a home screen
            BackControl renders nothing, and the mark must still sit
            right rather than sliding to the left edge. It lives on the
            button now that the button is the flex child — the mark's
            own geometry (h-7, shrink-0) is unchanged, so the band looks
            exactly as it did. */}
        <button
          type="button"
          onClick={goHome}
          data-testid="app-header-home"
          aria-label={t('layout.logoHome')}
          className="ml-auto mr-1 flex shrink-0 items-center"
        >
          <img
            src={markUrl}
            alt="Bimoto"
            data-testid="app-header-mark"
            className="h-7 w-auto shrink-0"
          />
        </button>
      </div>

      <StatusDetailSheet isOpen={detailOpen} onClose={() => setDetailOpen(false)} />
    </header>
  );
};

export default AppHeader;
