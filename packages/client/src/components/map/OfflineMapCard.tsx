// COMPONENTS/MAP/OFFLINE-MAP-CARD.TSX
//
// MAP-CACHE G5 — the Profile entry for the opt-in offline map.
// MAP-TRUTH G4 — with the PAUSED state, so an interrupted download says
// "20.4 MB already downloaded" instead of pretending it starts over.
//
// MAP-RWANDA G4 — and now it is the whole country, by province.
//
// Rwanda has five provinces and everyone here knows the country by them,
// so the list is structured the way the country is. A motari in Musanze
// takes Amajyaruguru; a passenger heading to Huye takes Amajyepfo. Each
// row is individually deletable, because the reason to delete is space
// and space is per-region.
//
// MAP-REACH G4 — FIVE ROWS, NOT SIX.
//
// Faustin's ruling on the card, 24 August: "Let have single provinces
// only." The all-Rwanda bundle was the redundancy the team kept tripping
// over — every square metre in it is already in one of the five
// provinces, at several times the bytes. It is no longer offered.
//
// It is NOT withdrawn, though, and the difference matters on a phone
// that already holds it: the archive stays on the server, the route
// still serves it, and the row below still appears — with its name, its
// date, its size and its Delete button — for anyone who downloaded it
// before the ruling. What stopped is proposing it to people who have
// not. The offered/servable seam lives in the shared registry
// (`offered`), not in a condition typed here, so the chip on a blank map
// and this card cannot come to different conclusions about what is on
// offer.
//
// WHERE THE NUMBERS COME FROM
// Every size on this screen is the real byte size of the real file on the
// server, from GET /api/map/regions. There is no estimate anywhere. The
// old card said "about 40 MB" beside an archive that turned out to be
// about 6 MB — a number a human typed is a number that goes stale, and a
// rider deciding whether to spend their bundle deserves the true one.
//
// The NAMES come from the shared region registry, so a region is named
// in exactly one place, in all three languages. The registry decides
// naming and order; it never decides what exists.

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  mapRegionsInTier,
  offeredMapRegionsInTier,
  type MapRegion,
} from '@bimoto/shared';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import {
  useMapCacheStore,
  initMapCache,
  refreshRegionAvailability,
  deleteRegionMap,
  EMPTY_REGION_STATE,
} from '../../services/map-cache';
import { OfflineMapRegionRow } from './OfflineMapRegionRow';

export const OfflineMapCard: React.FC = () => {
  const { t } = useTranslation();
  const regions = useMapCacheStore((s) => s.regions);
  const [pendingDelete, setPendingDelete] = useState<MapRegion | null>(null);

  useEffect(() => {
    void initMapCache();
    // Availability is asked for on open, not cached forever: the whole
    // promise is that a region provisioned on the server today shows up
    // for every rider without a new app build.
    void refreshRegionAvailability();
  }, []);

  const handleDelete = async () => {
    if (!pendingDelete) return;
    await deleteRegionMap(pendingDelete.key);
    setPendingDelete(null);
  };

  // MAP-REACH G1 — the row reads its own state and its own size from
  // useMapDownloadOffer now, so the card hands it a region and a delete
  // intent and nothing else. Same rendering; one derivation.
  const renderRow = (region: MapRegion) => (
    <OfflineMapRegionRow
      key={region.key}
      region={region}
      onRequestDelete={() => setPendingDelete(region)}
    />
  );

  /** Already on this phone — the one reason to show a region that is no
   *  longer offered. A rider who downloaded all of Rwanda before the
   *  ruling keeps the row that tells them how much space it is using and
   *  lets them get it back. */
  const isHeld = (region: MapRegion) =>
    (regions[region.key] ?? EMPTY_REGION_STATE).status === 'ready';

  const country = mapRegionsInTier('country').filter(isHeld);
  const provinces = offeredMapRegionsInTier('province');
  const districts = offeredMapRegionsInTier('district');

  return (
    <div className="bg-white rounded-xl shadow-sm p-4 mb-4" data-testid="offline-map-card">
      <h2 className="text-base font-semibold text-gray-900 mb-1">
        {t('map.offline.title')}
      </h2>
      <p className="text-sm text-gray-600 mb-1">{t('map.offline.intro')}</p>
      <p className="text-xs text-gray-500 mb-3">{t('map.offline.wifiHint')}</p>

      {/* Only ever non-empty on a phone that already holds it — see the
          header. Nobody is offered this tier any more. */}
      {country.length > 0 && (
        <section data-testid="offline-map-tier-country">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mt-2">
            {t('map.offline.tierCountry')}
          </h3>
          {country.map(renderRow)}
        </section>
      )}

      {provinces.length > 0 && (
        <section data-testid="offline-map-tier-province">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mt-4">
            {t('map.offline.tierProvince')}
          </h3>
          {provinces.map(renderRow)}
        </section>
      )}

      {/* Empty today. The tier exists so that a smaller pack later is a
          file on the server and three names in the registry, not another
          rewrite of this screen. */}
      {districts.length > 0 && (
        <section data-testid="offline-map-tier-district">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mt-4">
            {t('map.offline.tierDistrict')}
          </h3>
          {districts.map(renderRow)}
        </section>
      )}

      <Modal
        isOpen={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title={t('map.offline.delete')}
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-700">
            {t('map.offline.deleteConfirmNamed', {
              region: pendingDelete ? t(`map.regions.${pendingDelete.key}`) : '',
            })}
          </p>
          <div className="flex gap-2">
            <Button fullWidth variant="secondary" onClick={() => setPendingDelete(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              fullWidth
              variant="danger"
              onClick={() => void handleDelete()}
              data-testid="offline-map-delete-confirm"
            >
              {t('map.offline.delete')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default OfflineMapCard;
