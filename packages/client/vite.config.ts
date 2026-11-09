import { defineConfig, loadEnv, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// PREPROTO-AUTH G6 / CSP-TIGHTEN — strict CSP for the built app (the
// Capacitor WebView loads dist/index.html). script-src 'self' means
// injected markup cannot execute script, so a stored XSS cannot read the
// in-memory access token or reach the secure token store. connect-src is
// scoped to the one origin the client actually talks to: the VITE_API_URL
// baked into the build (fetch + Socket.io polling) and its websocket
// counterpart (Socket.io upgrade) — not blanket https:/wss:, so even a
// successful injection cannot exfiltrate to an attacker-controlled host.
// Plain-HTTP localhost is appended only for non-production builds so
// `vite preview` / the e2e stack (API at http://localhost:3000) keep
// working. A build with no VITE_API_URL set is by definition not a
// production build (production always bakes the real origin — see
// android-build.yml), so it gets the localhost allowance too.
// Build-time only: the Vite dev server needs its inline HMR scripts,
// which this would (correctly) block.
export function buildCsp(apiUrl: string | undefined, mode: string): string {
  const apiOrigin = new URL(apiUrl || 'http://localhost:3000').origin;
  const wsOrigin = apiOrigin.replace(/^http/, 'ws');
  const connectSrc = ["'self'", apiOrigin, wsOrigin];
  if (mode !== 'production' || !apiUrl) {
    connectSrc.push(
      'http://localhost:*',
      'ws://localhost:*',
      'http://127.0.0.1:*',
      'ws://127.0.0.1:*',
    );
  }
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    // MAP-TRUTH G2 — the canonical single OSM host, matching
    // src/components/map/tile-source.ts. A CSP wildcard
    // `*.tile.openstreetmap.org` does NOT match the bare host, so the
    // deprecated {s} sharding scheme and this allowance had to move
    // together or the packaged app would render a blank map.
    "img-src 'self' data: blob: https://tile.openstreetmap.org",
    `connect-src ${connectSrc.join(' ')}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

export function webviewCsp(csp: string): Plugin {
  return {
    name: 'bimoto-webview-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`,
      );
    },
  };
}

// MATCH-CLOSE G4 — the app's own build id, baked in at build time so the
// diagnostics screen can be compared against the server's. Same source
// as the server's stamp: BUILD_SHA in the environment, else the
// BUILD_SHA file scripts/stamp-build-sha.command writes at the repo
// root, else a git checkout, else 'unknown'. Never throws — an
// unstamped build simply reports 'unknown', exactly like the server.
export function resolveAppBuildSha(): string {
  if (process.env.BUILD_SHA) return process.env.BUILD_SHA.slice(0, 7);
  try {
    const stamped = readFileSync(resolve(process.cwd(), '../../BUILD_SHA'), 'utf8').trim();
    if (stamped) return stamped.split(/\s+/)[0].slice(0, 7);
  } catch {
    // No stamp file — fall through to git.
  }
  try {
    return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2_000,
    })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}

/**
 * CUTGUARD v2 G6 — the app version, read from the ONE place that already
 * decides it.
 *
 * `android/app/build.gradle` carries `bimotoDefaultVersionCode`, the
 * number the APK actually bakes, and the android-build workflow's smoke
 * step greps that same line and reads the version back OUT of the
 * assembled APK — so the file and the shipped binary cannot drift. A
 * second constant in TypeScript would be a third place to keep in step
 * and the first one to go stale, which is why this parses the gradle file
 * instead of declaring anything.
 *
 * Falls back to 0 rather than throwing. 0 is LEGACY, which is the safe
 * direction: a web build with no android/ directory beside it (and every
 * build made before this existed) reads as an old client and gets the old
 * behaviour, rather than being handed v14 payloads it cannot render.
 */
export function resolveAppVersion(): number {
  try {
    const gradle = readFileSync(
      resolve(process.cwd(), 'android/app/build.gradle'),
      'utf8',
    );
    const m = /def\s+bimotoDefaultVersionCode\s*=\s*(\d+)/.exec(gradle);
    if (m) return Number(m[1]);
  } catch {
    // No android project beside this build — web-only or a partial
    // checkout. Legacy is the honest answer.
  }
  return 0;
}

export default defineConfig(({ mode }) => ({
  define: {
    __APP_BUILD_SHA__: JSON.stringify(resolveAppBuildSha()),
    __APP_VERSION__: JSON.stringify(resolveAppVersion()),
  },
  plugins: [
    react(),
    webviewCsp(buildCsp(loadEnv(mode, process.cwd(), '').VITE_API_URL, mode)),
    VitePWA({
      registerType: 'autoUpdate',
      // COUNTER-READY G4(e) — the plugin no longer injects its own
      // registration script into index.html. src/services/register-sw.ts
      // owns the single call site, so the ONE question that had to be
      // asked before registering — is this the bundled Capacitor app? —
      // can be asked. See that file for the 51-of-66 field evidence.
      //
      // Everything else about the worker is unchanged: same generated
      // sw.js, same autoUpdate semantics (workbox bakes
      // skipWaiting/clientsClaim into it), same manifest, same runtime
      // caching. Only WHO calls register() has moved.
      injectRegister: null,
      includeAssets: [
        'icons/favicon.svg',
        'icons/icon-192.png',
        'icons/icon-512.png',
        'icons/icon-512-maskable.png',
        'icons/apple-touch-icon.png',
      ],
      manifest: {
        name: 'Bimoto',
        short_name: 'Bimoto',
        description: 'Book bike & moto taxis in Rwanda',
        // FIELD-UX G2 — brand surfaces carry the official brand blue.
        // The in-app UI palette (#1B4F72 text etc.) is deliberately NOT
        // migrated here; the two blues meet where the OS chrome
        // (status bar, splash, launcher) hands over to the app UI.
        theme_color: '#1340A7',
        background_color: '#F8F9FA',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          {
            src: '/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: '/icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/api\./i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24,
              },
              networkTimeoutSeconds: 5,
            },
          },
          {
            urlPattern: /^https:\/\/.*\.tile\.openstreetmap\.org\//i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'map-tiles',
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
            },
          },
        ],
      },
    }),
  ],
  // FIELD-UX G4 — deliberate WebView floor: Chrome/WebView 63. Before
  // this pin the emitted bundle silently required WebView >= 85 (Vite's
  // default 'modules' target). Rationale and the full decision record:
  // docs/webview-floor.md. build.target lowers SYNTAX only — new runtime
  // APIs (> Chrome 63) still need a guard or a local fallback.
  build: {
    target: 'chrome63',
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/setup.ts'],
  },
}));
