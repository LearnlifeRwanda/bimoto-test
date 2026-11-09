// FIELD-UX G2 — one-off brand asset pipeline. Renders every raster brand
// surface (PWA icons, favicon, apple-touch-icon, Android launcher set,
// splash screens) from the two authoritative SVGs in src/assets/brand/.
// Dev-only: sharp is a devDependency; nothing here ships at runtime.
//
//   node scripts/generate-brand-assets.mjs
//
// Re-run after any change to the brand SVGs, then commit the outputs.
import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BRAND = join(ROOT, 'src/assets/brand');
const ICONS = join(ROOT, 'public/icons');
const RES = join(ROOT, 'android/app/src/main/res');

const BRAND_BLUE = '#1340A7';
// The mark's viewBox (from BiMoto-mark.svg) — needed to embed it as a
// nested <svg> at an arbitrary size while preserving its 1.12:1 aspect.
const MARK_VIEWBOX = '491.10 728.10 305.80 272.95';
const MARK_AR = 272.95 / 305.8;

const appIconSvg = await readFile(join(BRAND, 'BiMoto-app-icon.svg'), 'utf8');
const markSvg = await readFile(join(BRAND, 'BiMoto-mark.svg'), 'utf8');
// Inner content of the mark, recolorable per surface.
const markInner = (color) =>
  markSvg
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .replace(/#1340A7/g, color);

// White mark centered on `bg` (or transparent), occupying `frac` of the
// canvas width — the composition every non-rounded surface uses.
function markOn(w, h, frac, bg, color = '#FFFFFF', shape = 'rect') {
  const mw = Math.round(Math.min(w, h * (1 / MARK_AR)) * frac);
  const mh = Math.round(mw * MARK_AR);
  const x = Math.round((w - mw) / 2);
  const y = Math.round((h - mh) / 2);
  const backdrop =
    bg === null
      ? ''
      : shape === 'circle'
        ? `<circle cx="${w / 2}" cy="${h / 2}" r="${w / 2}" fill="${bg}"/>`
        : `<rect width="${w}" height="${h}" fill="${bg}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
${backdrop}
<svg x="${x}" y="${y}" width="${mw}" height="${mh}" viewBox="${MARK_VIEWBOX}">${markInner(color)}</svg>
</svg>`;
}

async function render(svg, w, h, outPath) {
  await mkdir(dirname(outPath), { recursive: true });
  await sharp(Buffer.from(svg), { density: 300 })
    .resize(w, h)
    .png()
    .toFile(outPath);
  console.log(`wrote ${outPath} (${w}x${h})`);
}

// --- PWA icons (rounded-square app icon, transparent corners) ---
for (const size of [192, 512]) {
  await render(appIconSvg, size, size, join(ICONS, `icon-${size}.png`));
}
// Maskable: full-bleed brand blue, mark held inside the 80% safe zone
// (launcher masks may crop anything outside a centered circle).
await render(markOn(1024, 1024, 0.58, BRAND_BLUE), 512, 512, join(ICONS, 'icon-512-maskable.png'));
// Apple touch icon: iOS applies its own corner mask — full-bleed square,
// same mark inset as the app icon (~83% width).
await render(markOn(1024, 1024, 0.78, BRAND_BLUE), 180, 180, join(ICONS, 'apple-touch-icon.png'));
// SVG favicon is the mark itself, byte-exact.
await copyFile(join(BRAND, 'BiMoto-mark.svg'), join(ICONS, 'favicon.svg'));
console.log('wrote favicon.svg (copy of BiMoto-mark.svg)');

// --- Android launcher set (replaces the default Capacitor mipmaps) ---
// Legacy ic_launcher: the rounded-square app icon. ic_launcher_round:
// blue circle. ic_launcher_foreground: white mark on transparent inside
// the adaptive-icon safe zone (inner ~61% circle of the 108dp canvas);
// the background is @color/ic_launcher_background = brand blue.
const LAUNCHER = [
  ['mdpi', 48, 108],
  ['hdpi', 72, 162],
  ['xhdpi', 96, 216],
  ['xxhdpi', 144, 324],
  ['xxxhdpi', 192, 432],
];
for (const [dpi, size, fg] of LAUNCHER) {
  const dir = join(RES, `mipmap-${dpi}`);
  await render(appIconSvg, size, size, join(dir, 'ic_launcher.png'));
  await render(markOn(1024, 1024, 0.58, BRAND_BLUE, '#FFFFFF', 'circle'), size, size, join(dir, 'ic_launcher_round.png'));
  await render(markOn(1024, 1024, 0.44, null), fg, fg, join(dir, 'ic_launcher_foreground.png'));
}

// --- Splash screens: white mark centered on brand blue ---
const SPLASH = [
  ['drawable', 480, 320],
  ['drawable-land-mdpi', 480, 320],
  ['drawable-land-hdpi', 800, 480],
  ['drawable-land-xhdpi', 1280, 720],
  ['drawable-land-xxhdpi', 1600, 960],
  ['drawable-land-xxxhdpi', 1920, 1280],
  ['drawable-port-mdpi', 320, 480],
  ['drawable-port-hdpi', 480, 800],
  ['drawable-port-xhdpi', 720, 1280],
  ['drawable-port-xxhdpi', 960, 1600],
  ['drawable-port-xxxhdpi', 1280, 1920],
];
for (const [dir, w, h] of SPLASH) {
  // Mark at ~35% of the short edge — visible without shouting.
  const frac = (Math.min(w, h) * 0.35) / Math.min(w, h * (1 / MARK_AR));
  await render(markOn(w * 2, h * 2, frac, BRAND_BLUE), w, h, join(RES, dir, 'splash.png'));
}

console.log('brand assets generated.');
