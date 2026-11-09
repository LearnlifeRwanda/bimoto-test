// @vitest-environment node
//
// UI-POLISH G5 — typography configuration guard. Lives next to
// vite.config.ts (outside src/) like webview-csp.test.ts, so `tsc` —
// whose project only includes src — never trips over importing the
// untyped tailwind.config.js; vitest picks it up via its default
// include.
//
// Pins two load-bearing facts of the typeface work:
//   1. Tailwind resolves `sans` to self-hosted Space Grotesk (with a
//      system fallback stack) and `display` to Playfair Display, and
//      the five-step type scale exists with the agreed metrics.
//   2. index.css @font-face declarations are self-hosted only — every
//      src points into /fonts/, every face swaps during load, and the
//      referenced woff2 files actually ship in public/fonts. An
//      external font origin sneaking in would break the offline-first
//      guarantee (and the WebView CSP would block it anyway).
import { describe, test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import tailwindConfig from './tailwind.config.js';

const clientRoot = path.dirname(new URL(import.meta.url).pathname);
const theme = (tailwindConfig as { theme: { extend: Record<string, any> } }).theme.extend;

describe('font configuration', () => {
  test('sans resolves to Space Grotesk with a system fallback stack', () => {
    const sans = theme.fontFamily.sans as string[];
    expect(sans[0]).toBe('"Space Grotesk"');
    expect(sans[sans.length - 1]).toBe('sans-serif');
    expect(sans).toContain('system-ui');
  });

  test('display resolves to Playfair Display with a serif fallback', () => {
    const display = theme.fontFamily.display as string[];
    expect(display[0]).toBe('"Playfair Display"');
    expect(display[display.length - 1]).toBe('serif');
  });

  test('the five-step type scale is defined with line-heights', () => {
    const fontSize = theme.fontSize as Record<string, [string, { lineHeight: string }]>;
    expect(fontSize.title).toEqual(['1.375rem', { lineHeight: '1.75rem' }]);
    expect(fontSize.heading).toEqual(['1.125rem', { lineHeight: '1.625rem' }]);
    expect(fontSize.body).toEqual(['1rem', { lineHeight: '1.5rem' }]);
    expect(fontSize.secondary).toEqual(['0.875rem', { lineHeight: '1.25rem' }]);
    expect(fontSize.caption).toEqual(['0.75rem', { lineHeight: '1rem' }]);
  });
});

describe('self-hosted @font-face declarations', () => {
  const css = fs.readFileSync(path.join(clientRoot, 'src/index.css'), 'utf8');
  const faces = css.match(/@font-face\s*\{[^}]*\}/g) ?? [];

  test('declares both families across four subset faces', () => {
    expect(faces).toHaveLength(4);
    const families = faces.map((f) => /font-family:\s*'([^']+)'/.exec(f)?.[1]);
    expect(families.filter((f) => f === 'Space Grotesk')).toHaveLength(2);
    expect(families.filter((f) => f === 'Playfair Display')).toHaveLength(2);
  });

  test('every face is self-hosted, swaps during load, and is subset', () => {
    for (const face of faces) {
      expect(face).toMatch(/src:\s*url\('\/fonts\/[a-z0-9-]+\.woff2'\)/);
      expect(face).toContain('font-display: swap');
      expect(face).toContain('unicode-range:');
      expect(face).not.toMatch(/https?:/);
    }
  });

  test('every referenced woff2 file ships in public/fonts', () => {
    const urls = [...css.matchAll(/url\('(\/fonts\/[^']+)'\)/g)].map((m) => m[1]);
    expect(urls.length).toBeGreaterThanOrEqual(4);
    for (const url of urls) {
      expect(fs.existsSync(path.join(clientRoot, 'public', url))).toBe(true);
    }
  });
});
