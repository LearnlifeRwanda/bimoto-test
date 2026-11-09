// __TESTS__/MAP-DOWNLOAD-CHIP.TEST.TSX
//
// MAP-REACH G2/G3/G5 — the offer on the map, proven state by state.
//
// The machinery under this has been tested since MAP-CACHE; what was
// never tested — because it never existed — is whether a rider looking
// at a blank map is offered the fix. These are the four conditions that
// decide it, the tap that starts it, the percentage that reports it, and
// the dismissal that ends it.
//
// The map-cache service is REAL here (Dexie and apiFetch mocked, the
// same way OfflineMapCard.test.tsx does it), so a tap goes through the
// actual download path and the resulting store transitions are the real
// ones rather than a fixture's idea of them.

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

const cacheRows: Array<Record<string, unknown>> = [];
vi.mock('../db/dexie', () => ({
  db: {
    mapCache: {
      toArray: async () => cacheRows,
      put: async () => undefined,
      delete: async () => undefined,
      clear: async () => undefined,
    },
    mapDownloads: {
      toArray: async () => [],
      get: async () => undefined,
      put: async () => undefined,
      delete: async () => undefined,
      clear: async () => undefined,
    },
  },
}));

const apiFetchMock = vi.fn();
vi.mock('../lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

// The device's own network, which is what the chip asks — NOT API
// reachability. See MapCanvas's header on why those are different.
const connectedMock = vi.fn(() => true);
vi.mock('../hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => ({ connected: connectedMock() }),
}));

import { MapDownloadChip } from '../components/map/MapDownloadChip';
import { _resetMapCacheForTests } from '../services/map-cache';
import { mapOfferDismissedKey } from '../hooks/usePreferences';
import { i18n } from './setup';
import en from '../../public/locales/en/translation.json';

i18n.addResourceBundle('en', 'translation', { map: en.map, common: en.common }, true, true);

const SIX_MB = 6 * 1024 * 1024;

/** Let mounts, the Dexie read and any in-flight availability request
 *  settle, so "the chip is absent" is a conclusion rather than a race. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}

function regionsResponse(regions: Array<{ key: string; sizeBytes: number }>) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({
      regions: regions.map((r) => ({
        ...r,
        nameKey: `map.regions.${r.key}`,
        lastModified: 'Mon, 10 Aug 2026 09:00:00 GMT',
        etag: `"${r.sizeBytes.toString(16)}"`,
      })),
    }),
  };
}

/** Serve the region listing, and optionally the archive itself. */
function serve(opts: {
  regions?: Array<{ key: string; sizeBytes: number }>;
  archive?: unknown;
}) {
  apiFetchMock.mockImplementation(async (path: string) => {
    if (path === '/api/map/regions') {
      return regionsResponse(opts.regions ?? []);
    }
    return (
      opts.archive ?? {
        ok: false,
        status: 404,
        headers: { get: () => null },
        body: null,
      }
    );
  });
}

beforeEach(() => {
  _resetMapCacheForTests();
  cacheRows.length = 0;
  apiFetchMock.mockReset();
  connectedMock.mockReset().mockReturnValue(true);
  window.localStorage.clear();
  serve({ regions: [{ key: 'kigali', sizeBytes: SIX_MB }] });
});

// ─────────────────────────────────────────────────────────── visibility

describe('the visibility matrix', () => {
  test('no extract + online + not dismissed → the offer, with the real size', async () => {
    render(<MapDownloadChip />);

    await waitFor(() =>
      expect(screen.getByTestId('map-download-chip')).toBeInTheDocument(),
    );
    // The size is the server's byte count, formatted — never an estimate.
    expect(screen.getByTestId('map-download-chip-start')).toHaveTextContent(
      'Download the Kigali City map (6.0 MB) so this works without internet',
    );
  });

  test('extract already cached → no offer at all', async () => {
    cacheRows.push({
      key: 'kigali',
      blob: new Blob([new Uint8Array(64)]),
      sizeBytes: SIX_MB,
      downloadedAt: '2026-07-20T09:00:00.000Z',
    });
    render(<MapDownloadChip />);

    // Let the Dexie read and any availability request settle before
    // concluding absence — an early assertion would pass for the wrong
    // reason (nothing has rendered yet).
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());
    expect(screen.queryByTestId('map-download-chip')).not.toBeInTheDocument();
  });

  test('offline → no offer; a download that cannot start is a taunt', async () => {
    connectedMock.mockReturnValue(false);
    render(<MapDownloadChip />);

    await settle();
    expect(screen.queryByTestId('map-download-chip')).not.toBeInTheDocument();
    // And it does not even ask the server what it has.
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  test('dismissed for this region → no offer', async () => {
    window.localStorage.setItem(mapOfferDismissedKey('kigali'), 'true');
    render(<MapDownloadChip />);

    await settle();
    expect(screen.queryByTestId('map-download-chip')).not.toBeInTheDocument();
  });

  test('dismissal is PER REGION — dismissing Kigali leaves the north offer', async () => {
    window.localStorage.setItem(mapOfferDismissedKey('kigali'), 'true');
    serve({
      regions: [
        { key: 'kigali', sizeBytes: SIX_MB },
        { key: 'north', sizeBytes: 12 * 1024 * 1024 },
      ],
    });
    render(<MapDownloadChip regionKey="north" />);

    await waitFor(() =>
      expect(screen.getByTestId('map-download-chip')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('map-download-chip')).toHaveAttribute(
      'data-region',
      'north',
    );
  });

  test('a server without this archive → silence, not an invented size', async () => {
    // This app has no estimated megabytes anywhere (see the region
    // registry). With no real number there is nothing honest to offer.
    serve({ regions: [] });
    render(<MapDownloadChip />);

    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());
    expect(screen.queryByTestId('map-download-chip')).not.toBeInTheDocument();
  });

  test('a region that is no longer OFFERED is never proposed', async () => {
    // rwanda is still named and still servable — the server is listing
    // it here, at a real size — but the team ruling took it off offer.
    serve({ regions: [{ key: 'rwanda', sizeBytes: 90 * 1024 * 1024 }] });
    render(<MapDownloadChip regionKey="rwanda" />);

    await settle();
    expect(screen.queryByTestId('map-download-chip')).not.toBeInTheDocument();
  });
});

// ──────────────────────────────────────────────────────────── behaviour

describe('tap → start → progress', () => {
  test('one tap starts the real download and the line becomes a percentage', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let step = 0;
    serve({
      regions: [{ key: 'kigali', sizeBytes: 2000 }],
      archive: {
        ok: true,
        status: 200,
        headers: {
          get: (n: string) => (n.toLowerCase() === 'content-length' ? '2000' : null),
        },
        body: {
          getReader: () => ({
            read: async () => {
              step += 1;
              if (step === 1) return { done: false, value: new Uint8Array(1000) };
              if (step === 2) {
                await gate;
                return { done: false, value: new Uint8Array(1000) };
              }
              return { done: true, value: undefined };
            },
          }),
        },
      },
    });

    render(<MapDownloadChip />);
    await waitFor(() =>
      expect(screen.getByTestId('map-download-chip-start')).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId('map-download-chip-start'));

    await waitFor(() =>
      expect(screen.getByTestId('map-download-chip-percent')).toHaveTextContent('50%'),
    );
    expect(screen.getByTestId('map-download-chip-bar')).toHaveStyle({ width: '50%' });

    release();

    // And when it lands, the offer is gone — there is nothing left to
    // offer, because the map now has its extract.
    await waitFor(() =>
      expect(screen.queryByTestId('map-download-chip')).not.toBeInTheDocument(),
    );
  });

  test('nothing downloads without a tap', async () => {
    render(<MapDownloadChip />);
    await waitFor(() =>
      expect(screen.getByTestId('map-download-chip-start')).toBeInTheDocument(),
    );

    // 30 MB on Kigali mobile data is the rider's money. The only request
    // this component makes on its own is the region listing.
    const archiveCalls = apiFetchMock.mock.calls
      .map((c) => String(c[0]))
      .filter((p) => p.includes('.pmtiles'));
    expect(archiveCalls).toEqual([]);
  });
});

describe('dismissal', () => {
  test('the × hides it and the answer persists for that region', async () => {
    const { unmount } = render(<MapDownloadChip />);
    await waitFor(() =>
      expect(screen.getByTestId('map-download-chip')).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId('map-download-chip-dismiss'));
    await waitFor(() =>
      expect(screen.queryByTestId('map-download-chip')).not.toBeInTheDocument(),
    );

    // Durable, in prefs — the idiom hasSeenWelcome uses. NOT Dexie, which
    // is where the map BYTES live and which logout never clears.
    expect(window.localStorage.getItem(mapOfferDismissedKey('kigali'))).toBe('true');

    // A fresh mount on the next screen honours it.
    unmount();
    render(<MapDownloadChip />);
    await settle();
    expect(screen.queryByTestId('map-download-chip')).not.toBeInTheDocument();
  });
});
