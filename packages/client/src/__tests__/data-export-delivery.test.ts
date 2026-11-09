// ACCOUNT-RIGHTS-SURFACE G6 — the export reaches the user on BOTH runtimes.
//
// This is the group's real risk. The web path is easy and was never in
// doubt; the native path is the one that quietly does nothing, because an
// <a download> in a Capacitor WebView produces no file and no error. So
// every branch is driven here explicitly — including the one where the
// WebView has navigator.share but NOT file sharing, which is the shape
// that would otherwise reject at runtime on a real pilot phone.

import { describe, test, expect, vi, beforeEach } from 'vitest';
import {
  canShareFiles,
  deliverDataExport,
  type ExportEnvironment,
} from '../lib/data-export';

const JSON_BODY = '{"profile":{"id":"u1"}}';
const FILENAME = 'bimoto-data-export.json';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('web / PWA branch', () => {
  test('downloads through a Blob object URL and an anchor click', async () => {
    const createObjectURL = vi.fn(() => 'blob:fake');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });

    const clicked: string[] = [];
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = realCreate(tag) as HTMLElement;
      if (tag === 'a') {
        vi.spyOn(el, 'click').mockImplementation(() => {
          clicked.push((el as HTMLAnchorElement).download);
        });
      }
      return el;
    });

    const env: ExportEnvironment = { isNative: false };
    await expect(deliverDataExport(JSON_BODY, FILENAME, env)).resolves.toBe('downloaded');

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clicked).toEqual([FILENAME]);
    // The object URL must not be leaked: one blob per export, released.
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake');
    // No anchor is left behind in the document.
    expect(document.querySelectorAll('a[download]').length).toBe(0);
  });

  test('never reaches the share sheet or the clipboard on web', async () => {
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
    // Stub the click: a real one makes jsdom attempt a navigation.
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = realCreate(tag) as HTMLElement;
      if (tag === 'a') vi.spyOn(el, 'click').mockImplementation(() => {});
      return el;
    });
    const share = vi.fn(async () => {});
    const writeText = vi.fn(async () => {});

    await deliverDataExport(JSON_BODY, FILENAME, {
      isNative: false,
      share,
      canShare: () => true,
      writeText,
    });

    expect(share).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
  });
});

describe('native branch', () => {
  test('shares the file when the WebView supports file sharing', async () => {
    const share = vi.fn(async (_data: ShareData) => {});
    const env: ExportEnvironment = {
      isNative: true,
      share,
      canShare: (d) => Array.isArray(d.files) && d.files.length > 0,
      writeText: vi.fn(async () => {}),
    };

    await expect(deliverDataExport(JSON_BODY, FILENAME, env)).resolves.toBe('shared');

    expect(share).toHaveBeenCalledTimes(1);
    const shared = share.mock.calls[0][0];
    expect(shared.files).toHaveLength(1);
    expect((shared.files as File[])[0].name).toBe(FILENAME);
    expect(env.writeText).not.toHaveBeenCalled();
  });

  test('falls back to the clipboard when share exists but cannot take files', async () => {
    // Web Share Level 1: navigator.share is present, canShare is not. This
    // is the shape that would reject at runtime if we trusted `share`
    // alone — the exact reason canShareFiles demands both.
    const share = vi.fn(async () => {});
    const writeText = vi.fn(async () => {});

    await expect(
      deliverDataExport(JSON_BODY, FILENAME, { isNative: true, share, writeText }),
    ).resolves.toBe('copied');

    expect(share).not.toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledWith(JSON_BODY);
  });

  test('falls back to the clipboard when canShare refuses the file', async () => {
    const share = vi.fn(async () => {});
    const writeText = vi.fn(async () => {});

    await expect(
      deliverDataExport(JSON_BODY, FILENAME, {
        isNative: true,
        share,
        canShare: () => false,
        writeText,
      }),
    ).resolves.toBe('copied');

    expect(share).not.toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledWith(JSON_BODY);
  });

  test('throws rather than pretending when no route exists at all', async () => {
    await expect(deliverDataExport(JSON_BODY, FILENAME, { isNative: true })).rejects.toThrow(
      'no export delivery route available',
    );
  });
});

describe('canShareFiles', () => {
  const file = new File(['{}'], FILENAME, { type: 'application/json' });

  test('false without share', () => {
    expect(canShareFiles({ isNative: true }, file)).toBe(false);
  });

  test('false with share but no canShare (Level 1)', () => {
    expect(canShareFiles({ isNative: true, share: async () => {} }, file)).toBe(false);
  });

  test('false when canShare throws', () => {
    expect(
      canShareFiles(
        {
          isNative: true,
          share: async () => {},
          canShare: () => {
            throw new Error('boom');
          },
        },
        file,
      ),
    ).toBe(false);
  });

  test('true only when both are present and canShare accepts the file', () => {
    expect(
      canShareFiles({ isNative: true, share: async () => {}, canShare: () => true }, file),
    ).toBe(true);
  });
});
