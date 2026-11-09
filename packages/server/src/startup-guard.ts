// PREPROTO-SIM G1 — the invariant that simulated and real money can
// never be confused is enforced HERE, at process start, not by
// convention. index.ts calls this before listening and exits on throw.

interface SimulationModeConfig {
  NODE_ENV: 'development' | 'production' | 'test';
  PAYMENTS_MODE: 'live' | 'simulated';
  SMS_MODE: 'live' | 'simulated';
  FLW_SECRET_KEY: string;
  ALLOW_SIMULATED_IN_PROD: boolean;
  // PAY-TRUTH G4 — optional so existing callers (and the test-mode config
  // fallback) keep type-checking; absent reads as 'none'.
  SIMULATED_FAILURE_MODE?: string;
}

export function assertSimulationModeSafety(cfg: SimulationModeConfig): void {
  // PAY-TRUTH G4 — a fault injector pointed at a real gateway is not a
  // test, it is a way to invent declines for customers who could have
  // paid. The switch only means anything against the in-process fake, so
  // a live server carrying it is a misconfiguration, not a mode.
  const failureMode = cfg.SIMULATED_FAILURE_MODE ?? 'none';
  if (cfg.PAYMENTS_MODE === 'live' && failureMode !== 'none') {
    throw new Error(
      `PAYMENTS_MODE=live but SIMULATED_FAILURE_MODE=${failureMode}. Simulated ` +
        'gateway failures exist only for the in-process fake — unset ' +
        'SIMULATED_FAILURE_MODE, or switch PAYMENTS_MODE to simulated.',
    );
  }

  // A simulated-payments server holding real gateway keys is exactly the
  // ambiguity this guard exists to kill: an operator who flips the flag
  // back (or a bug that ignores it) would start moving real francs with
  // pilot-grade expectations. Refuse to start until the keys are removed.
  if (cfg.PAYMENTS_MODE === 'simulated' && cfg.FLW_SECRET_KEY !== '') {
    throw new Error(
      'PAYMENTS_MODE=simulated but FLW_SECRET_KEY is set. A simulated-payments ' +
        'server must not hold real gateway keys — unset FLW_SECRET_KEY ' +
        '(and FLW_PUBLIC_KEY) or switch PAYMENTS_MODE to live.',
    );
  }

  const anySimulated = cfg.PAYMENTS_MODE === 'simulated' || cfg.SMS_MODE === 'simulated';
  if (cfg.NODE_ENV === 'production' && anySimulated && !cfg.ALLOW_SIMULATED_IN_PROD) {
    throw new Error(
      `Refusing to start: NODE_ENV=production with PAYMENTS_MODE=${cfg.PAYMENTS_MODE} ` +
        `SMS_MODE=${cfg.SMS_MODE}. Simulated modes in production require the ` +
        'deliberate override ALLOW_SIMULATED_IN_PROD=true (see docs/pre-prototype-runbook.md).',
    );
  }
}

// GROUNDSKEEPER G2 — the SMS fail-open, closed at the only place it can
// be closed loudly.
//
// sms.service.ts used to decide "real send or just log it?" partly from
// whether AT_API_KEY was present. That made a missing or misspelt key
// indistinguishable from a deliberate development run: a production
// server would log every message to stdout — login OTPs included —
// return { success: true } to every caller, and report no fault anywhere.
// Every SMS the pilot depends on (OTP issuance, freeze notices, the SOS
// ops leg, ride reminders) would go nowhere, and the first anyone knew of
// it would be a rider who could not log in.
//
// The key is no longer part of that decision, so the missing key has to
// be caught here instead: SMS_MODE=live on a production server means the
// operator intends real messages, and no credential means it cannot send
// them. Refuse to start, the way the payments guards above do.
//
// Development is untouched on purpose. NODE_ENV=development with no key
// keeps logging locally (minus the message body), because a developer
// without an Africa's Talking account still has to be able to run the
// server — and a dev machine that swallows an SMS harms nobody. The
// escape hatch for a keyless pilot is SMS_MODE=simulated, which captures
// every message in the /api/sim inbox where it can actually be read.
interface SmsTransportConfig {
  NODE_ENV: 'development' | 'production' | 'test';
  SMS_MODE: 'live' | 'simulated';
  AT_API_KEY: string;
}

export function assertSmsTransportSafety(cfg: SmsTransportConfig): void {
  if (cfg.NODE_ENV !== 'production') return;
  if (cfg.SMS_MODE !== 'live') return;
  if (cfg.AT_API_KEY.trim() !== '') return;

  throw new Error(
    'Refusing to start: NODE_ENV=production with SMS_MODE=live but AT_API_KEY is ' +
      'empty. A live SMS transport with no credential sends nothing and reports ' +
      'success — OTP logins would silently stop working. Set AT_API_KEY, or run ' +
      'SMS_MODE=simulated to capture messages in the /api/sim inbox instead.',
  );
}

// SENDER-MATCH-2 — the SMS command tier can never open onto real money.
//
// SMS_COMMAND_TIER=full turns the money and marketplace commands back on
// for a channel that authenticates by caller ID: CONFIRM releases escrow,
// DISPUTE freezes it, CANCEL refunds it, and a bid can be accepted or
// withdrawn. The founder's ruling (22 Aug) is that those actions do not
// belong on caller-ID authentication until a deliberate design has earned
// them — and a ruling that lives only in a default is one env var away
// from being undone by someone who does not know it exists.
//
// So the flag is structurally prevented from reaching real francs. 'full'
// is allowed only against the simulated gateway, where testing the whole
// command set is exactly what it is for. Opening SMS money actions onto
// live payments requires changing this function — which is to say, having
// the conversation.
//
// Note the combination this must NOT catch: safe + live is the normal
// pilot boot, and the default of both settings.
interface SmsCommandTierConfig {
  SMS_COMMAND_TIER: 'safe' | 'full';
  PAYMENTS_MODE: 'live' | 'simulated';
}

export function assertSmsCommandTierSafety(cfg: SmsCommandTierConfig): void {
  if (cfg.SMS_COMMAND_TIER !== 'full') return;
  if (cfg.PAYMENTS_MODE !== 'live') return;

  throw new Error(
    'Refusing to start: SMS_COMMAND_TIER=full with PAYMENTS_MODE=live. The ' +
      'full SMS command set performs money actions (confirm releases escrow, ' +
      'dispute freezes it, cancel refunds it) on caller-ID authentication ' +
      'alone, which the pilot ruling puts off the table for real money. Run ' +
      'SMS_COMMAND_TIER=safe, or PAYMENTS_MODE=simulated to exercise the full ' +
      'set against the in-process fake.',
  )
}

// PILOT-GUARD Item 4 — the E2E payments hatch can never open onto real
// money.
//
// E2E_FAKE_PAYMENTS=1 short-circuits chargeCard to a synthetic SUCCESS
// and lets the bid and retry rails move an escrow to HELD against a
// synthetic 'e2e-' transaction id. Against the real gateway that is not
// a test mode, it is a way to tell a motari his fare is held when
// nothing was ever charged — and the escrow row says HELD, so nothing
// downstream disagrees.
//
// It was read at six production sites and set in exactly one workflow
// file, with no schema entry, no .env.example line and no guard: a live
// server carrying it booted cleanly. Same argument as
// assertSmsCommandTierSafety below it — a ruling that lives only in a
// default is one env var away from being undone.
//
// Note the combinations this must NOT catch: live + '0' is the shipped
// default and the normal pilot boot, and simulated + '1' is CI, where
// the fake gateway is the point.
interface FakePaymentsConfig {
  PAYMENTS_MODE: 'live' | 'simulated';
  E2E_FAKE_PAYMENTS: '0' | '1';
}

export function assertFakePaymentsSafety(cfg: FakePaymentsConfig): void {
  if (cfg.E2E_FAKE_PAYMENTS !== '1') return;
  if (cfg.PAYMENTS_MODE !== 'live') return;

  throw new Error(
    'Refusing to start: E2E_FAKE_PAYMENTS=1 with PAYMENTS_MODE=live. The ' +
      'E2E hatch returns a synthetic payment SUCCESS without calling the ' +
      'gateway and marks escrows HELD against synthetic transaction ids — ' +
      'against real payments that reports money as held that was never ' +
      'charged. Unset E2E_FAKE_PAYMENTS, or run PAYMENTS_MODE=simulated.',
  );
}
