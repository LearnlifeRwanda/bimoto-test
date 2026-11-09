// ACCOUNT-RIGHTS-SURFACE G3 — getting the export file into the person's
// hands, on both of the runtimes this app ships as.
//
// The endpoint has existed since before the pilot and had no caller. What
// stopped it being wired is not the request, it is the delivery: the two
// obvious answers are both wrong on one of the two runtimes.
//
//   web / PWA   — a Blob object URL on an <a download> is exactly right,
//                 and is the pattern DocumentLink.tsx already uses.
//   native app  — that same anchor does nothing in a Capacitor WebView.
//                 The file has to leave through the OS share sheet.
//
// And the share sheet is not guaranteed either: Web Share Level 2 (sharing
// FILES, not just a URL) is not present on every Android WebView the pilot
// phones run. So the native path feature-detects and falls back to the
// clipboard, which is unglamorous but always available and always honest —
// the toast tells the person their data is on the clipboard and to paste
// it somewhere, rather than pretending a file was saved.
//
// NO new dependency. @capacitor/filesystem and @capacitor/share are not
// installed and must not be (supply-chain gates, APK build), so every
// branch here is platform Web API plus the Capacitor core already present.

import { Capacitor } from '@capacitor/core';

export type ExportDelivery = 'downloaded' | 'shared' | 'copied';

/** The dependency surface, injected so the tests can drive BOTH branches
 *  without a real WebView and without monkey-patching globals wholesale. */
export interface ExportEnvironment {
  isNative: boolean;
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
  writeText?: (text: string) => Promise<void>;
}

/**
 * What this runtime actually is, read once at call time rather than at
 * module load: a test double must be able to replace it, and a hook fired
 * before Capacitor is ready must not cache the wrong answer.
 */
export function currentExportEnvironment(): ExportEnvironment {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  return {
    isNative: Capacitor.isNativePlatform(),
    share: nav?.share ? (data) => nav.share!(data) : undefined,
    canShare: nav?.canShare ? (data) => nav.canShare!(data) : undefined,
    writeText: nav?.clipboard?.writeText
      ? (text) => nav.clipboard.writeText(text)
      : undefined,
  };
}

/** True when this runtime can put an actual FILE through the share sheet.
 *  `navigator.share` alone is not enough — Level 1 shares text and URLs
 *  only, and calling it with files there rejects. */
export function canShareFiles(env: ExportEnvironment, file: File): boolean {
  if (!env.share) return false;
  // No canShare at all means Level 1: text/URL sharing, no files.
  if (!env.canShare) return false;
  try {
    return env.canShare({ files: [file] });
  } catch {
    return false;
  }
}

/**
 * Hand the export to the user by the best route this runtime offers.
 * Returns which route was taken so the caller can say the right thing;
 * throws only when no route worked at all.
 */
export async function deliverDataExport(
  json: string,
  filename: string,
  env: ExportEnvironment = currentExportEnvironment(),
): Promise<ExportDelivery> {
  if (!env.isNative) {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      // Revoking immediately is safe: the click has already handed the
      // blob to the browser's download machinery.
      URL.revokeObjectURL(url);
    }
    return 'downloaded';
  }

  const file = new File([json], filename, { type: 'application/json' });
  if (canShareFiles(env, file)) {
    await env.share!({ files: [file], title: filename });
    return 'shared';
  }

  if (env.writeText) {
    await env.writeText(json);
    return 'copied';
  }

  throw new Error('no export delivery route available');
}
