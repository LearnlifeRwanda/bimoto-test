// CUTGUARD v2 G6 — the version contract, and both gates at both versions.
//
// B-2 and B-3 are the same defect from opposite ends: during a rollout
// the server had ONE answer for two generations of client, and the two
// generations wanted different answers. A v13 passenger crashes on the
// new savings preview; a v13 motari is 428-locked out of his earnings by
// a prompt his build cannot answer.
//
// Every test here is a PAIR — v14 gets the new behaviour, legacy gets
// exactly da9eca0 — because a gate that cannot be shown to serve the old
// client is not a gate, it is an outage with a version check on it.
//
// The load-bearing one is the last block: the header is CLIENT-SUPPLIED,
// so claiming to be legacy must only ever get you LESS. A driver who has
// a PIN is gated at every version, and that is asserted directly.

import express from 'express';
import request from 'supertest';
import {
  APP_VERSION_HEADER,
  CURRENT_APP_VERSION,
  MIN_SUPPORTED_APP_VERSION,
  appVersionMiddleware,
  isCurrentApp,
  parseAppVersion,
  requireSupportedApp,
  upgradeRequiredResponse,
} from '../middleware/app-version';

/* ============================================================ the parser */

describe('parseAppVersion — every failure mode is 0', () => {
  test('a real version parses', () => {
    expect(parseAppVersion('14')).toBe(14);
    expect(parseAppVersion(' 15 ')).toBe(15);
    expect(parseAppVersion('0')).toBe(0);
  });

  test('anything that is not a non-negative integer is LEGACY', () => {
    // The safe direction, and the reason it is written as one regex
    // rather than parseInt: `parseInt('14.1-beta')` is 14, which would
    // have a gate believing a client it should not.
    for (const raw of [
      undefined,
      null,
      '',
      '   ',
      'v14',
      '14.1',
      '14.1-beta',
      '-1',
      'NaN',
      'Infinity',
      '1e3',
      '0x0e',
      ['14'],
      14,
    ]) {
      expect(parseAppVersion(raw as unknown)).toBe(0);
    }
  });

  test('an absurd number does not become a version', () => {
    expect(parseAppVersion('999999999999999999999')).toBe(0);
  });
});

describe('the middleware attaches a number, always', () => {
  const app = express();
  app.use(appVersionMiddleware);
  app.get('/probe', (req, res) => res.json({ appVersion: req.appVersion, current: isCurrentApp(req) }));

  test('a v14 header is read', async () => {
    const res = await request(app).get('/probe').set(APP_VERSION_HEADER, '14');
    expect(res.body).toEqual({ appVersion: 14, current: true });
  });

  test('no header at all reads as legacy — never undefined', async () => {
    const res = await request(app).get('/probe');
    expect(res.body).toEqual({ appVersion: 0, current: false });
  });

  test('a future version is current too', async () => {
    const res = await request(app).get('/probe').set(APP_VERSION_HEADER, '99');
    expect(res.body.current).toBe(true);
  });

  test('the version just below the cut is NOT current', async () => {
    const res = await request(app)
      .get('/probe')
      .set(APP_VERSION_HEADER, String(CURRENT_APP_VERSION - 1));
    expect(res.body.current).toBe(false);
  });
});

/* ================================================= the force-upgrade lever */

describe('the 426 lever exists and is deliberately off', () => {
  test('MIN_SUPPORTED_APP_VERSION is 0 — nobody is refused today', () => {
    // Not a placeholder. Bricking phones mid-pilot is the opposite
    // failure to the one this dispatch fixes; the flip is an operational
    // decision, like COUNTER_BID_ENABLED.
    expect(MIN_SUPPORTED_APP_VERSION).toBe(0);
  });

  test('with the lever off, even a version-0 client passes', async () => {
    const app = express();
    app.use(appVersionMiddleware);
    app.use(requireSupportedApp);
    app.get('/gated', (_req, res) => res.json({ ok: true }));

    const res = await request(app).get('/gated');
    expect(res.status).toBe(200);
  });

  test('the 426 body is DEFINED, so a client can be built against it', () => {
    // Shape-checked without being sent: the point of defining it now is
    // that the flip is a one-line change and not a design session held
    // during an incident.
    const body = upgradeRequiredResponse({ appVersion: 12 });
    expect(body.error.code).toBe('UPGRADE_REQUIRED');
    expect(body.error.message).toBe('errors.upgradeRequired');
    // `minVersion` is in the body so a client does not have to parse
    // prose to answer "am I the one being refused?".
    expect(body).toHaveProperty('minVersion');
    expect(body.yourVersion).toBe(12);
  });
});

/* ============================================== B-3, the money-PIN gate */

jest.mock('../services/money-pin.service', () => ({
  getMoneyPinStatus: jest.fn(),
}));

import { getMoneyPinStatus } from '../services/money-pin.service';
import {
  requireMoneyStepUp,
  openMoneyStepUp,
  _resetMoneyStepUpForTests,
} from '../middleware/money-step-up';

const DRIVER = 'driver-1';

function moneyApp() {
  const app = express();
  app.use(appVersionMiddleware);
  app.use((req, _res, next) => {
    req.user = { userId: DRIVER, role: 'DRIVER' } as never;
    next();
  });
  app.get('/earnings', requireMoneyStepUp, (_req, res) => res.json({ ok: true }));
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  _resetMoneyStepUpForTests();
});

describe('B-3 — a driver with NO PIN', () => {
  beforeEach(() => {
    (getMoneyPinStatus as jest.Mock).mockResolvedValue({
      state: 'NOT_SET',
      lockedUntil: null,
      pendingActivatesAt: null,
    });
  });

  test('v14 is asked to enrol — 428, unchanged', async () => {
    const res = await request(moneyApp()).get('/earnings').set(APP_VERSION_HEADER, '14');
    expect(res.status).toBe(428);
    expect(res.body.error.code).toBe('MONEY_PIN_ENROLLMENT_REQUIRED');
  });

  test('legacy is NOT locked out — this is the defect', async () => {
    // A v13 build has no enrollment screen, so 428 made his earnings a
    // dead end for the length of the rollout. He could not see his money.
    const res = await request(moneyApp()).get('/earnings').set(APP_VERSION_HEADER, '13');
    expect(res.status).toBe(200);
  });

  test('no header at all behaves exactly as da9eca0 did', async () => {
    const res = await request(moneyApp()).get('/earnings');
    expect(res.status).toBe(200);
  });
});

describe('B-3 — a driver who HAS a PIN is gated at EVERY version', () => {
  // The security half. `X-App-Version` is client-supplied, so if claiming
  // to be legacy could skip a PIN that exists, the gate would be a bypass
  // and D25 would be undone by a header. It cannot: the legacy arm is
  // only reachable when state === 'NOT_SET'.

  beforeEach(() => {
    (getMoneyPinStatus as jest.Mock).mockResolvedValue({
      state: 'SET',
      lockedUntil: null,
      pendingActivatesAt: null,
    });
  });

  test('v14 without a session — 401 MONEY_STEP_UP_REQUIRED', async () => {
    const res = await request(moneyApp()).get('/earnings').set(APP_VERSION_HEADER, '14');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('MONEY_STEP_UP_REQUIRED');
  });

  test('CLAIMING to be legacy does NOT skip a PIN that exists', async () => {
    const res = await request(moneyApp()).get('/earnings').set(APP_VERSION_HEADER, '13');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('MONEY_STEP_UP_REQUIRED');
  });

  test('sending no header does not skip it either', async () => {
    const res = await request(moneyApp()).get('/earnings');
    expect(res.status).toBe(401);
  });

  test('a real step-up session still opens the surface', async () => {
    openMoneyStepUp(DRIVER);
    const res = await request(moneyApp()).get('/earnings').set(APP_VERSION_HEADER, '14');
    expect(res.status).toBe(200);
  });

  test('a LOCKOUT is not version-gated either', async () => {
    (getMoneyPinStatus as jest.Mock).mockResolvedValue({
      state: 'SET',
      lockedUntil: new Date(Date.now() + 60_000),
      pendingActivatesAt: null,
    });
    const res = await request(moneyApp()).get('/earnings').set(APP_VERSION_HEADER, '13');
    expect(res.status).toBe(423);
    expect(res.body.error.code).toBe('MONEY_PIN_LOCKED');
  });
});
