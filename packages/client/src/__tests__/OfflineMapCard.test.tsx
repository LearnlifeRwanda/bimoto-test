// __TESTS__/OFFLINE-MAP-CARD.TEST.TSX
//
// MAP-CACHE G5 / MAP-RWANDA G4 / MAP-REACH G4 — the "Offline map"
// screen, exercising the REAL map-cache service (db + apiFetch mocked):
//   - the OFFERED set is exactly the five single provinces
//   - every row's size is the SERVER's byte count, never an estimate
//   - a region this server has not got says so, and offers no button
//   - download / progress + cancel / downloaded / delete, per region
//   - downloading one province leaves the others alone
//   - 404 on one region is a calm line, not an error screen
//
// The old card was one Kigali card with one hardcoded "about 40 MB"
// beside it. Both the singular and the estimate are gone: the country is
// downloadable a province at a time, and every megabyte shown is read
// off the real file by the server.

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const cacheRows: Array<Record<string, unknown>> = [];
const partialRows: Array<Record<string, unknown>> = [];
const dbPut = vi.fn();
const dbDelete = vi.fn();
vi.mock('../db/dexie', () => ({
  db: {
    mapCache: {
      toArray: async () => cacheRows,
      put: (...a: unknown[]) => dbPut(...a),
      delete: (...a: unknown[]) => dbDelete(...a),
      clear: async () => undefined,
    },
    mapDownloads: {
      toArray: async () => partialRows,
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

import { OfflineMapCard } from '../components/map/OfflineMapCard';
import { _resetMapCacheForTests } from '../services/map-cache';
import { i18n } from './setup';
import en from '../../public/locales/en/translation.json';

// The shared setup stub carries only chat-adjacent keys — this screen's
// copy (sizes, dates, region names) matters, so load the real resources.
i18n.addResourceBundle('en', 'translation', { map: en.map, common: en.common }, true, true);

const SIX_MB = 6 * 1024 * 1024;
const TWELVE_MB = 12 * 1024 * 1024;

/** The archive an already-installed app holds, keyed exactly as it has
 *  been since MAP-CACHE: the region key IS 'kigali'. */
const KIGALI_ENTRY = {
  key: 'kigali',
  blob: new Blob([new Uint8Array(64)]),
  sizeBytes: SIX_MB,
  downloadedAt: '2026-07-20T09:00:00.000Z',
};

/** GET /api/map/regions — what this server has provisioned. */
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

function archiveResponse(chunks: Uint8Array[]) {
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  let i = 0;
  return {
    ok: true,
    status: 200,
    headers: {
      get: (n: string) => (n.toLowerCase() === 'content-length' ? String(total) : null),
    },
    body: {
      getReader: () => ({
        read: async () =>
          i < chunks.length
            ? { done: false, value: chunks[i++] }
            : { done: true, value: undefined },
      }),
    },
  };
}

/** Route the mock by URL, the way the real server does. */
function serve(opts: {
  regions?: Array<{ key: string; sizeBytes: number }>;
  archives?: Record<string, unknown>;
}) {
  apiFetchMock.mockImplementation(async (path: string) => {
    if (path === '/api/map/regions') {
      return opts.regions
        ? regionsResponse(opts.regions)
        : { ok: false, status: 404, headers: { get: () => null }, body: null };
    }
    const region = /\/api\/map\/([a-z-]+)\.pmtiles/.exec(path)?.[1] ?? '';
    return (
      opts.archives?.[region] ?? {
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
  partialRows.length = 0;
  dbPut.mockReset().mockResolvedValue(undefined);
  dbDelete.mockReset().mockResolvedValue(undefined);
  apiFetchMock.mockReset();
  serve({ regions: [] });
});

describe('the offered set (MAP-REACH G4)', () => {
  // Faustin, on the card, 24 August: "Let have single provinces only."
  //
  // This is the assertion the ruling moved. It used to pin SIX rows with
  // all-of-Rwanda at the top; the whole-country bundle is the redundancy
  // the team kept tripping over, so it is no longer offered. Note what
  // did NOT change: the server still serves it, this app can still NAME
  // it, and the test below proves a phone that already holds it keeps
  // its row. Offering stopped; nothing was withdrawn.
  test('exactly the five single provinces, in registry order, by name', async () => {
    serve({
      regions: [
        { key: 'rwanda', sizeBytes: 90 * 1024 * 1024 },
        { key: 'kigali', sizeBytes: SIX_MB },
        { key: 'north', sizeBytes: TWELVE_MB },
      ],
    });
    render(<OfflineMapCard />);

    await waitFor(() =>
      expect(screen.getByTestId('offline-map-tier-province')).toBeInTheDocument(),
    );

    // The offered set, pinned exactly — five provinces and nothing else.
    const rows = screen
      .getAllByTestId(/^offline-map-row-[a-z]+$/)
      .map((el) => el.getAttribute('data-testid'));
    expect(rows).toEqual([
      'offline-map-row-kigali',
      'offline-map-row-north',
      'offline-map-row-south',
      'offline-map-row-east',
      'offline-map-row-west',
    ]);

    // Even though the server IS listing rwanda, and at a real size.
    expect(screen.queryByTestId('offline-map-row-rwanda')).not.toBeInTheDocument();
    expect(screen.queryByTestId('offline-map-tier-country')).not.toBeInTheDocument();
    expect(screen.queryByText('All of Rwanda')).not.toBeInTheDocument();

    // …and the five are shown by their real names, not their keys.
    expect(screen.getByText('Kigali City')).toBeInTheDocument();
    expect(screen.getByText('Northern Province')).toBeInTheDocument();
  });

  test('a phone that already holds all-of-Rwanda keeps its row', async () => {
    // The ruling stopped OFFERING the bundle. It did not reach onto a
    // rider's phone: the bytes are theirs, the row is how they see the
    // space it costs, and Delete is how they get it back.
    cacheRows.push({
      key: 'rwanda',
      blob: new Blob([new Uint8Array(64)]),
      sizeBytes: 90 * 1024 * 1024,
      downloadedAt: '2026-08-01T09:00:00.000Z',
    });
    serve({ regions: [] });
    render(<OfflineMapCard />);

    await waitFor(() =>
      expect(screen.getByTestId('offline-map-row-rwanda-ready')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('offline-map-tier-country')).toBeInTheDocument();
    expect(screen.getByText('All of Rwanda')).toBeInTheDocument();
    expect(screen.getByTestId('offline-map-row-rwanda-delete')).toBeInTheDocument();
    // Update stays too: the route still serves this archive, so a rider
    // who has it can refresh it. What is gone is the Download button that
    // would PROPOSE it to somebody who has not got it.
    expect(screen.getByTestId('offline-map-row-rwanda-update')).toBeInTheDocument();
    expect(screen.queryByTestId('offline-map-row-rwanda-download')).not.toBeInTheDocument();
  });

  test('sizes come from the server, and are the real byte counts', async () => {
    serve({ regions: [{ key: 'north', sizeBytes: TWELVE_MB }] });
    render(<OfflineMapCard />);

    await waitFor(() =>
      expect(screen.getByTestId('offline-map-row-north-size')).toHaveTextContent('12.0 MB'),
    );
    // The old hardcoded "about 40 MB" is gone from the screen entirely.
    expect(screen.queryByText(/40 MB/)).not.toBeInTheDocument();
  });

  test('a region this server has not got says so and offers no button', async () => {
    serve({ regions: [{ key: 'kigali', sizeBytes: SIX_MB }] });
    render(<OfflineMapCard />);

    await waitFor(() =>
      expect(screen.getByTestId('offline-map-row-west-unavailable')).toBeInTheDocument(),
    );
    // Shown rather than hidden: a rider told they can download their
    // province must not find the row simply missing.
    expect(screen.queryByTestId('offline-map-row-west-download')).not.toBeInTheDocument();
    // And the one that IS provisioned is downloadable.
    expect(screen.getByTestId('offline-map-row-kigali-download')).toBeInTheDocument();
  });
});

describe('per-region download', () => {
  test('downloading a province: progress, cancel, then ready', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let step = 0;
    serve({
      regions: [{ key: 'north', sizeBytes: 2000 }],
      archives: {
        north: {
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
      },
    });

    render(<OfflineMapCard />);
    await waitFor(() =>
      expect(screen.getByTestId('offline-map-row-north-download')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('offline-map-row-north-download'));

    await waitFor(() =>
      expect(screen.getByTestId('offline-map-row-north-downloading')).toBeInTheDocument(),
    );
    expect(screen.getByText(/50%/)).toBeInTheDocument();
    expect(screen.getByTestId('offline-map-row-north-cancel')).toBeInTheDocument();

    // The other rows are untouched — one download is one region.
    expect(
      screen.queryByTestId('offline-map-row-kigali-downloading'),
    ).not.toBeInTheDocument();

    release();
    await waitFor(() =>
      expect(screen.getByTestId('offline-map-row-north-ready')).toBeInTheDocument(),
    );
    expect(dbPut).toHaveBeenCalledTimes(1);
    expect(dbPut.mock.calls[0][0]).toMatchObject({ key: 'north' });
    expect(screen.getByTestId('offline-map-row-north-update')).toBeInTheDocument();
    expect(screen.getByTestId('offline-map-row-north-delete')).toBeInTheDocument();
  });

  test('a tap downloads only the region tapped', async () => {
    serve({
      regions: [
        { key: 'kigali', sizeBytes: 100 },
        { key: 'north', sizeBytes: 100 },
      ],
      archives: { north: archiveResponse([new Uint8Array(100)]) },
    });
    render(<OfflineMapCard />);
    await waitFor(() =>
      expect(screen.getByTestId('offline-map-row-north-download')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('offline-map-row-north-download'));

    await waitFor(() =>
      expect(screen.getByTestId('offline-map-row-north-ready')).toBeInTheDocument(),
    );
    const archiveCalls = apiFetchMock.mock.calls
      .map((c) => String(c[0]))
      .filter((p) => p.includes('.pmtiles'));
    expect(archiveCalls).toEqual(['/api/map/north.pmtiles']);
  });

  test('404 on one region is calm, and leaves the others alone', async () => {
    serve({ regions: [{ key: 'north', sizeBytes: 100 }] }); // archive 404s
    render(<OfflineMapCard />);
    await waitFor(() =>
      expect(screen.getByTestId('offline-map-row-north-download')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('offline-map-row-north-download'));

    await waitFor(() =>
      expect(screen.getByTestId('offline-map-row-north-unavailable')).toBeInTheDocument(),
    );
    // No failure styling, and the button stays for when the server gains
    // the archive.
    expect(screen.queryByTestId('offline-map-row-north-error')).not.toBeInTheDocument();
    expect(screen.getByTestId('offline-map-row-north-download')).toBeInTheDocument();
  });

  test('a failed download shows the retry line on that row only', async () => {
    apiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/api/map/regions')
        return regionsResponse([{ key: 'north', sizeBytes: 100 }]);
      throw new Error('network down');
    });
    render(<OfflineMapCard />);
    await waitFor(() =>
      expect(screen.getByTestId('offline-map-row-north-download')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('offline-map-row-north-download'));

    await waitFor(() =>
      expect(screen.getByTestId('offline-map-row-north-error')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('offline-map-row-kigali-error')).not.toBeInTheDocument();
  });
});

describe('an already-downloaded region', () => {
  test('shows its date and size and can be deleted by name', async () => {
    cacheRows.push(KIGALI_ENTRY);
    serve({ regions: [{ key: 'kigali', sizeBytes: SIX_MB }] });
    render(<OfflineMapCard />);

    await waitFor(() =>
      expect(screen.getByTestId('offline-map-row-kigali-ready')).toBeInTheDocument(),
    );
    // The downloaded row carries date and size together, once.
    expect(screen.getByTestId('offline-map-row-kigali-ready')).toHaveTextContent('6.0 MB');
    expect(screen.queryByTestId('offline-map-row-kigali-size')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('offline-map-row-kigali-delete'));
    // The confirmation names the region — deleting the wrong province
    // costs a rider a whole re-download.
    await waitFor(() =>
      expect(screen.getByTestId('offline-map-delete-confirm')).toBeInTheDocument(),
    );
    expect(screen.getByText(/Delete the offline map for Kigali City/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('offline-map-delete-confirm'));

    await waitFor(() =>
      expect(screen.getByTestId('offline-map-row-kigali-download')).toBeInTheDocument(),
    );
    expect(dbDelete).toHaveBeenCalledWith('kigali');
  });

  test('stays visible even if the server stops listing it', async () => {
    // The rider has the bytes on their phone; a server that dropped the
    // archive does not take their copy away.
    cacheRows.push(KIGALI_ENTRY);
    serve({ regions: [] });
    render(<OfflineMapCard />);

    await waitFor(() =>
      expect(screen.getByTestId('offline-map-row-kigali-ready')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('offline-map-row-kigali-delete')).toBeInTheDocument();
  });
});
