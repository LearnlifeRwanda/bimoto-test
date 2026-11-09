import { assertSimulationModeSafety } from '../startup-guard';

const base = {
  NODE_ENV: 'development' as const,
  PAYMENTS_MODE: 'live' as const,
  SMS_MODE: 'live' as const,
  FLW_SECRET_KEY: '',
  ALLOW_SIMULATED_IN_PROD: false,
};

describe('assertSimulationModeSafety', () => {
  test('passes for an all-live config with real keys', () => {
    expect(() =>
      assertSimulationModeSafety({
        ...base,
        NODE_ENV: 'production',
        FLW_SECRET_KEY: 'FLWSECK-real',
      }),
    ).not.toThrow();
  });

  test('passes for fully simulated dev config with no keys', () => {
    expect(() =>
      assertSimulationModeSafety({
        ...base,
        PAYMENTS_MODE: 'simulated',
        SMS_MODE: 'simulated',
      }),
    ).not.toThrow();
  });

  // PAY-TRUTH G4 — a fault injector pointed at a real gateway is not a
  // test, it is a way to invent declines for customers who could have paid.
  test('throws when a simulated failure mode is set against a LIVE gateway', () => {
    expect(() =>
      assertSimulationModeSafety({
        ...base,
        PAYMENTS_MODE: 'live',
        SIMULATED_FAILURE_MODE: 'insufficient_funds',
      }),
    ).toThrow(/SIMULATED_FAILURE_MODE/);
  });

  test('allows a failure mode against the simulated gateway', () => {
    expect(() =>
      assertSimulationModeSafety({
        ...base,
        PAYMENTS_MODE: 'simulated',
        SIMULATED_FAILURE_MODE: 'gateway_down',
      }),
    ).not.toThrow();
  });

  test("an absent or 'none' failure mode never blocks a live gateway", () => {
    expect(() => assertSimulationModeSafety({ ...base })).not.toThrow();
    expect(() =>
      assertSimulationModeSafety({ ...base, SIMULATED_FAILURE_MODE: 'none' }),
    ).not.toThrow();
  });

  test('throws when PAYMENTS_MODE=simulated while FLW_SECRET_KEY is set', () => {
    expect(() =>
      assertSimulationModeSafety({
        ...base,
        PAYMENTS_MODE: 'simulated',
        FLW_SECRET_KEY: 'FLWSECK-real',
      }),
    ).toThrow(/FLW_SECRET_KEY/);
  });

  test('key check applies in every NODE_ENV, including test', () => {
    expect(() =>
      assertSimulationModeSafety({
        ...base,
        NODE_ENV: 'test',
        PAYMENTS_MODE: 'simulated',
        FLW_SECRET_KEY: 'FLWSECK-real',
      }),
    ).toThrow(/FLW_SECRET_KEY/);
  });

  test('throws for simulated payments in production without the override', () => {
    expect(() =>
      assertSimulationModeSafety({
        ...base,
        NODE_ENV: 'production',
        PAYMENTS_MODE: 'simulated',
      }),
    ).toThrow(/ALLOW_SIMULATED_IN_PROD/);
  });

  test('throws for simulated SMS in production without the override', () => {
    expect(() =>
      assertSimulationModeSafety({
        ...base,
        NODE_ENV: 'production',
        SMS_MODE: 'simulated',
      }),
    ).toThrow(/ALLOW_SIMULATED_IN_PROD/);
  });

  test('allows simulated modes in production with the explicit override', () => {
    expect(() =>
      assertSimulationModeSafety({
        ...base,
        NODE_ENV: 'production',
        PAYMENTS_MODE: 'simulated',
        SMS_MODE: 'simulated',
        ALLOW_SIMULATED_IN_PROD: true,
      }),
    ).not.toThrow();
  });

  test('the override does NOT bypass the real-keys check', () => {
    expect(() =>
      assertSimulationModeSafety({
        ...base,
        NODE_ENV: 'production',
        PAYMENTS_MODE: 'simulated',
        FLW_SECRET_KEY: 'FLWSECK-real',
        ALLOW_SIMULATED_IN_PROD: true,
      }),
    ).toThrow(/FLW_SECRET_KEY/);
  });
});
