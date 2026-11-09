// PILOT-GUARD Item 4 — every combination of the payments kill-switch.
//
// E2E_FAKE_PAYMENTS was read at six production sites and declared in
// none: no zod entry, no .env.example line, no startup guard. A server
// booted with PAYMENTS_MODE=live and E2E_FAKE_PAYMENTS=1 started
// cleanly and marked escrows HELD against synthetic transaction ids.
//
// Four combinations exist and all four are asserted, because the guard
// is only correct if it refuses exactly one of them — in particular it
// must not touch the shipped default (live + '0'), which is the normal
// pilot boot, nor CI (simulated + '1'), where the fake gateway is the
// point.

import { assertFakePaymentsSafety } from '../startup-guard';

describe('assertFakePaymentsSafety — the E2E hatch cannot open onto real money', () => {
  test('live + 1 REFUSES', () => {
    expect(() =>
      assertFakePaymentsSafety({ PAYMENTS_MODE: 'live', E2E_FAKE_PAYMENTS: '1' }),
    ).toThrow(/Refusing to start/);
  });

  test('the refusal names what goes wrong, not just the flag', () => {
    let message = '';
    try {
      assertFakePaymentsSafety({ PAYMENTS_MODE: 'live', E2E_FAKE_PAYMENTS: '1' });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/synthetic/);
    expect(message).toMatch(/never charged/);
    expect(message).toMatch(/PAYMENTS_MODE=simulated/);
  });

  test('live + 0 — the SHIPPED DEFAULT and the normal pilot boot — is allowed', () => {
    expect(() =>
      assertFakePaymentsSafety({ PAYMENTS_MODE: 'live', E2E_FAKE_PAYMENTS: '0' }),
    ).not.toThrow();
  });

  test('simulated + 1 — what CI runs — is allowed', () => {
    expect(() =>
      assertFakePaymentsSafety({ PAYMENTS_MODE: 'simulated', E2E_FAKE_PAYMENTS: '1' }),
    ).not.toThrow();
  });

  test('simulated + 0 is allowed', () => {
    expect(() =>
      assertFakePaymentsSafety({ PAYMENTS_MODE: 'simulated', E2E_FAKE_PAYMENTS: '0' }),
    ).not.toThrow();
  });
});

describe('the flag is declared where the other switches are declared', () => {
  const read = (rel: string) =>
    require('fs').readFileSync(require('path').join(__dirname, rel), 'utf8');

  test('config.ts carries a schema entry with the shipped default', () => {
    const src = read('../config.ts');
    expect(src).toMatch(/E2E_FAKE_PAYMENTS: z\.enum\(\['0', '1'\]\)\.default\('0'\)/);
  });

  test('index.ts calls the guard before the server listens', () => {
    const src = read('../index.ts');
    expect(src).toMatch(/assertFakePaymentsSafety\(config\)/);
    // Alongside its three siblings, inside the same abort-on-throw block.
    expect(src.indexOf('assertFakePaymentsSafety(config)')).toBeGreaterThan(
      src.indexOf('assertSimulationModeSafety(config)'),
    );
  });

  test('.env.example documents it in a test-only section', () => {
    const src = read('../../../../.env.example');
    expect(src).toMatch(/# Test-only switches/);
    expect(src).toMatch(/^E2E_FAKE_PAYMENTS="0"$/m);
  });
});
