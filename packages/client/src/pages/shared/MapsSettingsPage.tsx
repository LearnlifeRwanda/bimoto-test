// PAGES/SHARED/MAPS-SETTINGS-PAGE.TSX
//
// MAP-REACH G4 — the obvious door.
//
// The offline-map manager has existed since MAP-CACHE G5 and was mounted
// in exactly one place: the Profile screen, below the emergency contacts
// and above the logout button. Nothing in Settings pointed at it, so
// "where do I turn the offline map on?" had one answer and it was not
// the one anybody guessed.
//
// This page is the second door. It mounts the SAME OfflineMapCard —
// there is one manager, rendered in two places, not a second manager
// with its own idea of what is downloaded. Profile keeps its mount: a
// rider who already knows where it lives should not have to relearn it.
//
// Deliberately its own route rather than a section inside SettingsPage:
// the card is tall (five province rows, each with its own state), and
// dropping it inline would push the emergency contacts, the diagnostics
// toggle and the account-rights section below a screenful of map rows.

import React from 'react';
import { useTranslation } from 'react-i18next';
import { OfflineMapCard } from '../../components/map/OfflineMapCard';

export const MapsSettingsPage: React.FC = () => {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-6" data-testid="maps-settings-page">
      <div className="w-full max-w-sm mx-auto">
        <h1 className="text-xl font-bold text-[#1B4F72] mb-4">
          {t('settings.mapsOffline')}
        </h1>
        <OfflineMapCard />
      </div>
    </div>
  );
};

export default MapsSettingsPage;
