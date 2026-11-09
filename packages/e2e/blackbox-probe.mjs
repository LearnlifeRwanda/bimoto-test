// BLACKBOX probe — observe, on a live local stack, what the user sees and
// what survives for each class of error. It produced both the before-table
// and the after-table in docs/error-ledger.md.
//
//   node packages/e2e/blackbox-probe.mjs --label before|after
//
// Requires: server on :3000 (NODE_ENV=test so the OTP seam works), Vite
// client on :5173, a seeded database.
//
// Triggers C/D/E need nothing from the app. Triggers A and B need a
// component that throws, so a run applies a temporary four-line patch to
// DiagnosticsPage.tsx and Toast.tsx (throw when the URL carries
// ?g1crash=screen / ?g1crash=root) and reverts it afterwards — see
// docs/error-ledger.md §1. Toast renders OUTSIDE ScreenErrorBoundary,
// which is what makes B a top-level-boundary case.
import { chromium, request } from '@playwright/test';

const API = 'http://localhost:3000';
const CLIENT = 'http://localhost:5173';
const label = process.argv.includes('--label')
  ? process.argv[process.argv.indexOf('--label') + 1]
  : 'before';

async function login(phone) {
  const api = await request.newContext({ baseURL: API });
  const otpRes = await api.post('/api/auth/request-otp', { data: { phone } });
  const otpBody = await otpRes.json();
  if (!otpBody.testOtp) throw new Error(`no testOtp: ${JSON.stringify(otpBody)}`);
  const verify = await api.post('/api/auth/verify-otp', {
    data: { phone, otp: otpBody.testOtp },
  });
  if (!verify.ok()) throw new Error(`verify failed ${verify.status()} ${await verify.text()}`);
  await api.post('/api/users/me/accept-privacy', { data: { version: '1.0' } });
  await api.post('/api/users/me/accept-terms', { data: { version: '1.0' } });
  const state = await api.storageState();
  await api.dispose();
  return { cookies: state.cookies };
}

/** Everything durable this origin holds, so "what survived" is a fact. */
async function snapshotPersistence(page) {
  return page.evaluate(async () => {
    const ls = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        const v = localStorage.getItem(k) ?? '';
        ls[k] = v.length > 120 ? `${v.slice(0, 120)}…(${v.length} chars)` : v;
      }
    } catch (e) {
      ls['<error>'] = String(e);
    }
    const ss = {};
    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        ss[k] = (sessionStorage.getItem(k) ?? '').slice(0, 120);
      }
    } catch (e) {
      ss['<error>'] = String(e);
    }
    const idb = {};
    try {
      const dbs = (await indexedDB.databases?.()) ?? [];
      for (const meta of dbs) {
        const counts = await new Promise((resolve) => {
          const req = indexedDB.open(meta.name);
          req.onsuccess = () => {
            const db = req.result;
            const names = Array.from(db.objectStoreNames);
            if (names.length === 0) {
              db.close();
              resolve({});
              return;
            }
            const out = {};
            const tx = db.transaction(names, 'readonly');
            let left = names.length;
            for (const n of names) {
              const c = tx.objectStore(n).count();
              c.onsuccess = () => {
                out[n] = c.result;
                if (--left === 0) {
                  db.close();
                  resolve(out);
                }
              };
              c.onerror = () => {
                out[n] = 'err';
                if (--left === 0) {
                  db.close();
                  resolve(out);
                }
              };
            }
          };
          req.onerror = () => resolve({ '<error>': 'open failed' });
        });
        idb[meta.name] = counts;
      }
    } catch (e) {
      idb['<error>'] = String(e);
    }
    return { localStorage: ls, sessionStorage: ss, indexedDB: idb };
  });
}

function diffPersistence(before, after) {
  const out = [];
  for (const area of ['localStorage', 'sessionStorage']) {
    for (const k of Object.keys(after[area])) {
      if (!(k in before[area])) out.push(`+${area}.${k} = ${after[area][k]}`);
      else if (before[area][k] !== after[area][k]) out.push(`~${area}.${k} = ${after[area][k]}`);
    }
    for (const k of Object.keys(before[area])) {
      if (!(k in after[area])) out.push(`-${area}.${k}`);
    }
  }
  const bi = JSON.stringify(before.indexedDB);
  const ai = JSON.stringify(after.indexedDB);
  if (bi !== ai) out.push(`~indexedDB ${bi} -> ${ai}`);
  return out;
}

/** The ledger as it stands on disk — the whole point of the after-run. */
async function readLedger(page) {
  return page.evaluate(() => {
    try {
      const raw = localStorage.getItem('bimoto-error-ledger-v1');
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
}

/** What the user is looking at, in the app's own test ids and copy. */
async function whatUserSees(page) {
  return page.evaluate(() => {
    const has = (sel) => !!document.querySelector(sel);
    const text = (sel) => document.querySelector(sel)?.textContent?.trim() ?? null;
    const root = document.getElementById('root');
    return {
      rootChildren: root ? root.children.length : 0,
      screenFallback: has('[data-testid="screen-error-fallback"]'),
      screenFallbackText: text('[data-testid="screen-error-fallback"]')?.slice(0, 140) ?? null,
      screenRetry: has('[data-testid="screen-error-retry"]'),
      screenHome: has('[data-testid="screen-error-home"]'),
      rootBoundary:
        !has('[data-testid="screen-error-fallback"]') &&
        (document.body.innerText || '').includes('Something went wrong'),
      bodyText: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 200),
      pathname: location.pathname + location.search,
    };
  });
}

const results = [];

async function probe(name, page, run) {
  const consoleLines = [];
  const pageErrors = [];
  const onConsole = (m) => {
    if (m.type() === 'error' || m.type() === 'warning') consoleLines.push(`${m.type()}: ${m.text().slice(0, 200)}`);
  };
  const onPageError = (e) => pageErrors.push(String(e.message).slice(0, 200));
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  const before = await snapshotPersistence(page);
  const ledgerBefore = await readLedger(page);
  let sees;
  try {
    sees = await run(page);
  } catch (e) {
    sees = { error: String(e) };
  }
  await page.waitForTimeout(900);
  const after = await snapshotPersistence(page);
  const ledgerAfter = await readLedger(page);
  page.off('console', onConsole);
  page.off('pageerror', onPageError);
  results.push({
    trigger: name,
    userSees: sees,
    consoleErrors: consoleLines,
    pageErrors,
    persistenceDelta: diffPersistence(before, after),
    // Entries this trigger added, not the whole ring: "exactly one
    // entry per trigger" is the claim under test.
    ledgerAdded: ledgerAfter.slice(ledgerBefore.length),
    ledgerAddedCount: ledgerAfter.length - ledgerBefore.length,
  });
  console.log(`\n=== ${name} ===`);
  console.log(JSON.stringify(results[results.length - 1], null, 2));
}

const main = async () => {
  const session = await login('+250781234567');
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
  });
  const ctx = await browser.newContext({ baseURL: CLIENT });
  await ctx.addCookies(
    session.cookies.map((c) => ({ ...c, domain: 'localhost', path: '/' })),
  );

  // English so the table reads in the repo's source locale.
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('bimoto-lang', 'en');
    } catch {
      /* ignore */
    }
  });

  const page = await ctx.newPage();
  await page.goto(`${CLIENT}/diagnostics`);
  await page.waitForSelector('[data-testid="diagnostics-panel"]', { timeout: 20000 });

  // 1. Render error INSIDE a screen — caught by ScreenErrorBoundary.
  await probe('A. render error inside a screen (ScreenErrorBoundary)', page, async (p) => {
    await p.goto(`${CLIENT}/diagnostics?g1crash=screen`);
    await p.waitForTimeout(1200);
    return whatUserSees(p);
  });

  // 2. Render error OUTSIDE any screen boundary — top-level ErrorBoundary.
  await probe('B. render error outside a screen (top-level ErrorBoundary)', page, async (p) => {
    await p.goto(`${CLIENT}/diagnostics?g1crash=root`);
    await p.waitForTimeout(1200);
    return whatUserSees(p);
  });

  // Back to a healthy screen for the non-render triggers.
  await page.goto(`${CLIENT}/diagnostics`);
  await page.waitForSelector('[data-testid="diagnostics-panel"]', { timeout: 20000 });

  // 3. Unhandled promise rejection.
  await probe('C. unhandled promise rejection', page, async (p) => {
    await p.evaluate(() => {
      void Promise.reject(new Error('G1 probe: lost promise'));
    });
    await p.waitForTimeout(800);
    return whatUserSees(p);
  });

  // 4. window.onerror-class error (throw from a timer, outside React).
  await probe('D. window.onerror-class error', page, async (p) => {
    await p.evaluate(() => {
      setTimeout(() => {
        throw new Error('G1 probe: window error');
      }, 0);
    });
    await p.waitForTimeout(800);
    return whatUserSees(p);
  });

  // 5. Failed API call (5xx) through apiFetch, from a live screen: the
  //    Diagnostics Refresh button re-asks /api/health via apiFetch.
  await probe('E. failed API call (5xx)', page, async (p) => {
    await p.route('**/api/health', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'G1_PROBE', message: 'errors.generic' } }),
      }),
    );
    await p.getByRole('button', { name: /refresh|ongera|actualiser/i }).click();
    await p.waitForTimeout(1500);
    const sees = await whatUserSees(p);
    sees.serverBuildRow = await p
      .locator('[data-testid="diag-server-build"]')
      .textContent();
    await p.unroute('**/api/health');
    return sees;
  });

  await browser.close();

  const fs = await import('node:fs');
  const url = await import('node:url');
  const here = url.fileURLToPath(new URL('.', import.meta.url));
  const out = `${here}../../docs/error-ledger-probe-${label}.json`;
  fs.writeFileSync(out, JSON.stringify(results, null, 2));
  console.log(`\nwrote ${out}`);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
