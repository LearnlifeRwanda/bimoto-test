// COMPONENTS/MAP/OFFLINE-MAP-REGION-ROW.TSX
//
// MAP-RWANDA G4 — one region's row on the offline-map screen.
//
// The states are the ones the Kigali card already had, because they were
// the right ones; what changed is that there are now six rows instead of
// one card, and each carries its REAL size from the server rather than a
// number somebody typed:
//
//   not downloaded → real size + Download
//   downloading    → progress bar + Cancel
//   paused         → "20.4 MB already downloaded" + Resume / Discard
//   downloaded     → date + size + Update / Delete
//   not provisioned→ one calm line, no button
//
// Download starts ONLY on an explicit tap here — never automatically.
// This is a phone on Kigali mobile data; nothing on this screen may
// spend a rider's bundle without them saying so.
//
// MAP-REACH G1 — the wiring (which store slices, which verbs, and the
// order the five states are decided in) moved to
// hooks/useMapDownloadOffer, so the chip that offers the same download
// on a blank map reads it from the same place. This row renders exactly
// what it rendered before; it just no longer owns the derivation.

import React from 'react';
import { useTranslation } from 'react-i18next';
import type { MapRegion } from '@bimoto/shared';
import { Button } from '../ui/Button';
import { useMapDownloadOffer } from '../../hooks/useMapDownloadOffer';

export function formatMb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

/**
 * The download date, in the rider's language when we know it.
 *
 * toLocaleDateString THROWS a RangeError on an undefined language tag,
 * and i18n.language is undefined before a language has resolved — which
 * meant the row rendered a white screen at exactly the moment a download
 * finished. Caught by the MAP-RWANDA e2e walk, on the real app. The
 * fallback is the runtime's own default locale, which is what passing
 * nothing has always meant.
 */
export function formatDate(iso: string, language?: string): string {
  try {
    return new Date(iso).toLocaleDateString(language || undefined);
  } catch {
    return new Date(iso).toLocaleDateString();
  }
}

export interface OfflineMapRegionRowProps {
  region: MapRegion;
  onRequestDelete: () => void;
}

export const OfflineMapRegionRow: React.FC<OfflineMapRegionRowProps> = ({
  region,
  onRequestDelete,
}) => {
  const { t, i18n } = useTranslation();
  // The state AND the real server-side size, from the one offer hook.
  const { phase, progress, meta, lastError, partialBytes, sizeBytes, start, cancel, discard } =
    useMapDownloadOffer(region.key);
  const testId = `offline-map-row-${region.key}`;

  const name = t(`map.regions.${region.key}`);

  return (
    <div className="py-3 border-b border-gray-100 last:border-b-0" data-testid={testId}>
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <span className="text-sm font-medium text-gray-900">{name}</span>
        {/* The size a rider needs BEFORE they decide. Once the region is
            downloaded the meta line below carries date and size
            together, so repeating it here would just say the same
            megabytes twice. */}
        {phase !== 'ready' && sizeBytes !== null && (
          <span className="text-xs text-gray-500" data-testid={`${testId}-size`}>
            {t('map.offline.size', { mb: formatMb(sizeBytes) })}
          </span>
        )}
      </div>

      {phase === 'downloading' ? (
        <div data-testid={`${testId}-downloading`}>
          <p className="text-xs text-gray-600 mb-2">
            {t('map.offline.downloading')}
            {progress !== null && (
              <span className="font-semibold"> {Math.round(progress * 100)}%</span>
            )}
          </p>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-2">
            <div
              className="h-full bg-[#1B4F72] rounded-full transition-all"
              style={{ width: `${Math.round((progress ?? 0) * 100)}%` }}
              data-testid={`${testId}-progress-bar`}
            />
          </div>
          <Button
            fullWidth
            variant="secondary"
            onClick={cancel}
            data-testid={`${testId}-cancel`}
          >
            {t('common.cancel')}
          </Button>
        </div>
      ) : phase === 'ready' && meta ? (
        <div data-testid={`${testId}-ready`}>
          <p className="text-xs text-gray-600 mb-2">
            {t('map.offline.downloadedMeta', {
              date: formatDate(meta.downloadedAt, i18n.language),
              mb: formatMb(meta.sizeBytes),
            })}
          </p>
          {lastError === 'failed' && (
            <p className="text-xs text-[#E74C3C] mb-2" data-testid={`${testId}-error`}>
              {t('map.offline.failed')}
            </p>
          )}
          <div className="flex gap-2">
            <Button
              fullWidth
              variant="secondary"
              onClick={start}
              data-testid={`${testId}-update`}
            >
              {t('map.offline.update')}
            </Button>
            <Button
              fullWidth
              variant="danger"
              onClick={onRequestDelete}
              data-testid={`${testId}-delete`}
            >
              {t('map.offline.delete')}
            </Button>
          </div>
        </div>
      ) : phase === 'paused' ? (
        <div data-testid={`${testId}-paused`}>
          <p className="text-xs text-gray-600 mb-1">{t('map.offline.paused')}</p>
          <p className="text-xs text-gray-500 mb-2" data-testid={`${testId}-partial-meta`}>
            {t('map.offline.resumeMeta', { mb: formatMb(partialBytes) })}
          </p>
          {lastError === 'no-space' && (
            <p className="text-xs text-[#E74C3C] mb-2" data-testid={`${testId}-no-space`}>
              {t('map.offline.noSpace')}
            </p>
          )}
          {lastError === 'failed' && (
            <p className="text-xs text-[#E74C3C] mb-2" data-testid={`${testId}-error`}>
              {t('map.offline.failed')}
            </p>
          )}
          <div className="flex gap-2">
            <Button
              fullWidth
              onClick={start}
              data-testid={`${testId}-resume`}
            >
              {t('map.offline.resume')}
            </Button>
            <Button
              fullWidth
              variant="secondary"
              onClick={discard}
              data-testid={`${testId}-discard`}
            >
              {t('map.offline.discard')}
            </Button>
          </div>
        </div>
      ) : phase === 'unprovisioned' ? (
        // The server does not have this one. Shown rather than hidden:
        // the list would otherwise change shape as the operator
        // provisions, and a rider told they can download their province
        // would find no row at all and conclude the app was broken.
        // "Not available yet" is the truth and it is short.
        <p className="text-xs text-gray-500" data-testid={`${testId}-unavailable`}>
          {t('map.offline.notAvailable')}
        </p>
      ) : (
        <div data-testid={`${testId}-none`}>
          {lastError === 'failed' && (
            <p className="text-xs text-[#E74C3C] mb-2" data-testid={`${testId}-error`}>
              {t('map.offline.failed')}
            </p>
          )}
          {lastError === 'no-space' && (
            <p className="text-xs text-[#E74C3C] mb-2" data-testid={`${testId}-no-space`}>
              {t('map.offline.noSpace')}
            </p>
          )}
          {lastError === 'unavailable' && (
            <p className="text-xs text-gray-500 mb-2" data-testid={`${testId}-unavailable`}>
              {t('map.offline.notAvailable')}
            </p>
          )}
          <Button
            fullWidth
            onClick={start}
            data-testid={`${testId}-download`}
          >
            {t('map.offline.download')}
          </Button>
        </div>
      )}
    </div>
  );
};

export default OfflineMapRegionRow;
