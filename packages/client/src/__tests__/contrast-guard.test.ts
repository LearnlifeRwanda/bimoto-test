import { describe, test, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// PILOT-READY G1/G5 — contrast regression guard.
//
// The UI-POLISH audit (#134) measured seven WCAG AA failures and two
// undersized touch targets; PILOT-READY fixed them. This guard pins the
// corrected token/background pairs to their thresholds (4.5:1 for text,
// 3:1 for meaningful non-text) so a palette tweak cannot silently push
// a pair back under, and scans the client source so the removed failing
// utility classes cannot creep back in.

// --- WCAG 2.1 relative luminance + contrast ratio -----------------------

function srgbChannel(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  return (
    0.2126 * srgbChannel(parseInt(h.slice(0, 2), 16)) +
    0.7152 * srgbChannel(parseInt(h.slice(2, 4), 16)) +
    0.0722 * srgbChannel(parseInt(h.slice(4, 6), 16))
  );
}

export function contrastRatio(fg: string, bg: string): number {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** Alpha-composite fg over bg (both hex), e.g. Tailwind's white/80. */
function blend(fg: string, bg: string, alpha: number): string {
  const px = (h: string) =>
    [h.slice(1, 3), h.slice(3, 5), h.slice(5, 7)].map((c) => parseInt(c, 16));
  const f = px(fg);
  const b = px(bg);
  return (
    '#' +
    f
      .map((c, i) => Math.round(alpha * c + (1 - alpha) * b[i]))
      .map((c) => c.toString(16).padStart(2, '0'))
      .join('')
  );
}

// Tailwind default palette values + brand colours used by the fixes.
const C = {
  white: '#ffffff',
  gray50: '#f9fafb',
  gray100: '#f3f4f6',
  gray200: '#e5e7eb',
  gray500: '#6b7280',
  gray600: '#4b5563',
  gray700: '#374151',
  green50: '#f0fdf4',
  green700: '#15803d',
  red400: '#f87171',
  red600: '#dc2626',
  amber700: '#b45309',
  navy: '#1B4F72',
  successDark: '#1E8449', // Button success bg (one step down from #27AE60)
  dangerDark: '#C0392B', // Button danger bg (one step down from #E74C3C)
};

// The fair-price banner background: bg-[#1B4F72]/10 over the gray-50 page.
const FAIR_PRICE_BG = blend(C.navy, C.gray50, 0.1);

const TEXT_AA = 4.5;
const NON_TEXT_AA = 3.0;

// Every corrected pair, with the sites it covers.
const TEXT_PAIRS: Array<[string, string, string]> = [
  ['gray-500 secondary text on white', C.gray500, C.white],
  ['gray-500 secondary text on gray-50 pages', C.gray500, C.gray50],
  ['gray-600 chat timestamp on gray-100 bubble', C.gray600, C.gray100],
  ['gray-600 pending step number on gray-200 circle', C.gray600, C.gray200],
  ['green-700 fee-waived / savings text on white', C.green700, C.white],
  ['green-700 VERIFIED badge text on green-50', C.green700, C.green50],
  ['red-600 commission text on white', C.red600, C.white],
  ['amber-700 simulated-mode caption on white', C.amber700, C.white],
  ['white simulation banner text on amber-700', C.white, C.amber700],
  ['white admin approve text on green-700', C.white, C.green700],
  ['white admin reject text on red-600', C.white, C.red600],
  ['white Button success label on #1E8449', C.white, C.successDark],
  ['white Button danger label on #C0392B', C.white, C.dangerDark],
  ['fair-price note: full navy on navy/10-over-gray-50', C.navy, FAIR_PRICE_BG],
  ['white/80 duration caption on navy header', blend(C.white, C.navy, 0.8), C.navy],
  ['white/70 captions on navy headers', blend(C.white, C.navy, 0.7), C.navy],
];

const NON_TEXT_PAIRS: Array<[string, string, string]> = [
  ['green-700 pickup dot on white card', C.green700, C.white],
  ['red-600 destination dot on white card', C.red600, C.white],
  ['gray-500 inactive carousel dot on white', C.gray500, C.white],
  ['gray-600 interactive icons (close/delete/nav) on white', C.gray600, C.white],
  ['red-400 recording dot on navy header', C.red400, C.navy],
];

describe('PILOT-READY contrast guard', () => {
  test.each(TEXT_PAIRS)('%s meets 4.5:1', (_label, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(TEXT_AA);
  });

  test.each(NON_TEXT_PAIRS)('%s meets 3:1', (_label, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(NON_TEXT_AA);
  });
});

// --- Source scan: the removed failing classes must not come back --------

// Classes the sweep removed. text-gray-400 is allowed only where WCAG
// does not apply: disabled controls (LoginPage) and purely decorative
// placeholder illustrations (GoodsPickupPage).
const FORBIDDEN =
  /\b(text-green-500|text-red-500|text-green-600|text-amber-600|bg-amber-600|text-gray-400)\b/;

const ALLOWLIST = new Set([
  '__tests__/contrast-guard.test.ts',
  'pages/auth/LoginPage.tsx', // disabled: state only — WCAG-exempt
  'pages/driver/GoodsPickupPage.tsx', // decorative placeholder icons
]);

const SRC_ROOT = join(__dirname, '..');

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectSourceFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe('PILOT-READY contrast guard — failing utility classes stay out', () => {
  test('no client source reintroduces a removed low-contrast class', () => {
    const offenders: string[] = [];
    for (const file of collectSourceFiles(SRC_ROOT)) {
      const rel = relative(SRC_ROOT, file).replace(/\\/g, '/');
      if (ALLOWLIST.has(rel)) continue;
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (FORBIDDEN.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
