// COMPONENTS/MAP/MAP-DOWNLOAD-CHIP.TSX
//
// MAP-REACH G2 — the offer, where the map is.
//
// The download machinery has worked for several dispatches. The doorway
// was the problem: OfflineMapCard was mounted in exactly ONE place, the
// Profile screen, and nothing on any map, in Settings, or at first run
// pointed at it. A rider staring at a blank rectangle had no path to the
// fix. This is that path — one plain line, on the map that is failing,
// at the moment it fails.
//
// WHAT IT IS
//   "Download the Kigali map (6.0 MB) so this works without internet"
//   one tap → starts, and the same line becomes a live percentage.
//   an × → gone, for this region, for good (see the dismissal note).
//
// WHAT IT IS NOT
//   It never blocks. It is an overlay pinned to the bottom of the map
//   with `pointer-events-none` on the positioning layer, so the map
//   underneath keeps panning and every booking control keeps working
//   with the chip on screen. Nothing in a booking flow waits for it.
//
//   It never downloads on its own. `start` is wired to a tap and to
//   nothing else. 30 MB on Kigali mobile data is the rider's money, and
//   the explicit-tap rule that governs OfflineMapRegionRow governs this
//   equally — see services/map-cache.ts.
//
// WHEN IT SHOWS — all four must hold:
//   1. the cache has actually been consulted (not merely "Dexie has not
//      answered yet"). Offering a download to a phone that already holds
//      the archive, for the two frames before Dexie answers, is the
//      first-paint bug this project already fixed once for the map
//      itself; useMapCacheResolved exists precisely so it is not
//      reintroduced here.
//   2. no extract is cached at all. With one, the map is not blank and
//      there is nothing to offer.
//   3. the device has a network. A download that cannot start is a
//      taunt — offline, the surface keeps its existing "map can't load"
//      line and says nothing about downloading.
//   4. the rider has not dismissed this region, and the server actually
//      has this region (a real size — this app never shows an estimated
//      megabyte; see shared/constants/map-regions.ts).
//
// The size comes from GET /api/map/regions like every other size in the
// app. Until that answers there is no honest number to show, so there is
// no chip: `sizeBytes === null` is a reason to stay silent, not a reason
// to invent "about 30 MB".

import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { LEGACY_MAP_REGION, isOfferedMapRegion } from '@bimoto/shared';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { useMapCacheResolved, useOfflineMap } from '../../hooks/useOfflineMap';
import { useMapDownloadOffer } from '../../hooks/useMapDownloadOffer';
import { useMapOfferDismissed } from '../../hooks/usePreferences';
import { ensureRegionAvailability } from '../../services/map-cache';
import { useUIStore } from '../../stores/ui.store';
import { formatMb } from './OfflineMapRegionRow';

export interface MapDownloadChipProps {
  /**
   * Which region to offer. Defaults to Kigali — the capital, the pilot's
   * whole operating area, and the one archive a pilot phone is most
   * likely to want. A surface that knows better (a motari heading north)
   * can name another; the region must be one the registry OFFERS.
   */
  regionKey?: string;
  /**
   * Extra positioning for the fixed/absolute wrapper. Surfaces differ:
   * the full-viewport MapCanvas sits above the tab bar, the small
   * in-card maps sit inside their own rounded box.
   */
  className?: string;
}

export const MapDownloadChip: React.FC<MapDownloadChipProps> = ({
  regionKey = LEGACY_MAP_REGION,
  className = 'absolute inset-x-0 bottom-2 px-3',
}) => {
  const { t } = useTranslation();
  const { connected } = useNetworkStatus();
  const cacheResolved = useMapCacheResolved();
  const offlineMap = useOfflineMap();
  const offer = useMapDownloadOffer(regionKey);
  const { dismissed, dismiss } = useMapOfferDismissed(regionKey);

  // Ask the server what it has, once per session, and only when this
  // chip could actually use the answer. Deduped in the service so five
  // map surfaces on one screen make one request, not five.
  const mightOffer = cacheResolved && !offlineMap && connected && !dismissed;
  useEffect(() => {
    if (mightOffer) void ensureRegionAvailability();
  }, [mightOffer]);

  // MAP-REACH G3 — say so when it lands.
  //
  // A finished download changes the map underneath without any
  // navigation: useOfflineMaps re-resolves off the map-cache store,
  // BaseTileLayer swaps to the local extract and clears any raster
  // failure with it. That is the right behaviour and it is also silent —
  // the rider tapped a line about working without internet and the line
  // simply vanished. One toast closes that loop.
  //
  // Fired on the DOWNLOADING → READY edge only, and only by the chip
  // that watched it happen, so mounting a second map does not re-announce
  // a download that finished ten minutes ago.
  const showToast = useUIStore((st) => st.showToast);
  const wasDownloading = useRef(false);
  useEffect(() => {
    if (offer.phase === 'downloading') {
      wasDownloading.current = true;
      return;
    }
    if (offer.phase === 'ready' && wasDownloading.current) {
      wasDownloading.current = false;
      showToast(
        t('map.offline.chipDone', { region: t(`map.regions.${regionKey}`) }),
        'success',
      );
    }
  }, [offer.phase, regionKey, showToast, t]);

  // A region the registry no longer offers is never proposed here, even
  // if the server still serves it. One source of truth for "on offer".
  if (!isOfferedMapRegion(regionKey)) return null;
  if (!mightOffer) return null;
  // Downloading is the one phase that keeps the chip up without an
  // extract: the rider tapped, and the percentage is the feedback.
  if (offer.phase !== 'idle' && offer.phase !== 'downloading') return null;
  if (offer.sizeBytes === null) return null;

  const name = t(`map.regions.${regionKey}`);
  const downloading = offer.phase === 'downloading';

  return (
    <div
      className={`${className} z-[400] pointer-events-none`}
      data-testid="map-download-chip"
      data-region={regionKey}
    >
      <div className="pointer-events-auto mx-auto flex max-w-md items-center gap-2 rounded-lg bg-white/95 px-3 py-2 shadow-lg ring-1 ring-black/5">
        {downloading ? (
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-gray-700">
              {t('map.offline.chipProgress', { region: name })}
              {offer.percent !== null && (
                <span
                  className="font-semibold"
                  data-testid="map-download-chip-percent"
                >
                  {' '}
                  {offer.percent}%
                </span>
              )}
            </p>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full rounded-full bg-[#1B4F72] transition-all"
                style={{ width: `${offer.percent ?? 0}%` }}
                data-testid="map-download-chip-bar"
              />
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={offer.start}
            data-testid="map-download-chip-start"
            className="min-h-[44px] min-w-0 flex-1 text-left text-xs leading-snug text-gray-800"
          >
            {t('map.offline.chipOffer', {
              region: name,
              mb: formatMb(offer.sizeBytes),
            })}
          </button>
        )}

        {/* Dismissal stays available DURING the download too: a rider who
            changes their mind should not have to wait for it to finish to
            get the line off their map. It hides the chip, it does not
            cancel the download — Settings → Maps & offline is where a
            download is cancelled, and the bytes already fetched are kept
            and resumable either way. */}
        <button
          type="button"
          onClick={() => void dismiss()}
          aria-label={t('common.close')}
          data-testid="map-download-chip-dismiss"
          className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center text-gray-500 hover:text-gray-800"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
};

export default MapDownloadChip;
