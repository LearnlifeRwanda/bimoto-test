import React from 'react';
import { useTranslation } from 'react-i18next';
import { AppHeader } from './AppHeader';
import { BottomNav } from './BottomNav';
import { ScreenErrorBoundary } from '../ScreenErrorBoundary';
import { useOutboxToasts } from '../../hooks/useOutboxToasts';

export interface AppShellProps {
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({ children }) => {
  const { t } = useTranslation();

  // CHROME-C G3 — held bookings and refusals announce themselves and
  // get out of the way. One mount, in the shell, because the news has
  // to reach someone who may be three screens from where they made the
  // booking — and because a second mount would double every toast.
  useOutboxToasts();

  return (
    <div className="min-h-screen bg-[#F8F9FA] flex flex-col">
      {/* CHROME-C G2 — the shell's top chrome is the header and nothing
          else.

          It used to be the header plus four conditional strips —
          SyncIndicator, ConnectionBanner, RejectedEventsBanner,
          OutboxBanner. In flow they displaced content by up to 126 px
          as connectivity moved (PARCEL-PARITY G4 measured it); floated,
          they stopped moving anything but covered the top of every
          screen instead, permanently in the case of the always-on
          "Connected" strip. Option C removes the dilemma rather than
          picking a side: the ambient state is two words inside the
          header, events are toasts, and anything still waiting is a
          badge on the status pill. Every screen gets the 24 px back.

          The band keeps its z-10 so the header still sits above the
          full-bleed map (MapCanvas is `fixed inset-x-0 top-0 z-0`) and
          below the bottom sheet (z-30), BottomNav (z-40), the floating
          SOS (z-50) and Toast (z-[60]).

          The picker-screen collision that APP-HEADER G1 recorded here
          as KNOWN, MEASURED is fixed: LocationPickerMap's overlay used
          to sit at `top-3`, so its mode chips painted over this band on
          the four picker screens. With status living here that was no
          longer survivable, and the overlay now clears the header. */}
      <div className="relative z-10">
        <AppHeader />
      </div>
      {/* DEADWOOD G4 — the Toast mount that used to sit here is gone.
          Toast reads one message out of ui.store and renders it, so two
          mounts meant every toast appeared twice, and screen readers
          heard the same role="alert" announced twice. The survivor is
          App.tsx's, above the router: it covers the shell-less screens
          this one never could — welcome, login, register, consent,
          onboarding and the whole admin island — all of which emit
          toasts. Keeping this one instead would have silenced them. */}
      <main className="flex-1 pb-20" role="main" aria-label={t('layout.mainContent')}>
        {/* PROFILE-RESCUE G3 — one screen's crash must leave the shell
            and the bottom nav alive (the Kigali Profile trap). */}
        <ScreenErrorBoundary>{children}</ScreenErrorBoundary>
      </main>
      <BottomNav />
    </div>
  );
};
