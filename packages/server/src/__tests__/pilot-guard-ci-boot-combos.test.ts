// PILOT-GUARD amendment — every env combination CI declares must boot.
//
// The e2e job set E2E_FAKE_PAYMENTS=1 and never set PAYMENTS_MODE, so it
// inherited the zod default 'live' — the exact live+fake combination the
// Item-4 startup guard exists to refuse. The first boot under the new
// guard refused, wait-on /api/health timed out, and the job went red:
// the failure surfaced in the slowest possible oracle. This test moves
// that discovery to the cheapest one.
//
// The combos are read FROM the workflow files, not restated here: a
// future workflow edit that declares a guard-refused combination fails
// in `pnpm test:server`, in the editing PR, before anything boots.
// Undeclared keys resolve through the REAL envSchema (exported from
// config.ts), so the defaults in play are the defaults the server will
// actually apply — never a hand-copied list.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { envSchema } from '../config';
import {
  assertFakePaymentsSafety,
  assertSimulationModeSafety,
  assertSmsCommandTierSafety,
  assertSmsTransportSafety,
} from '../startup-guard';

const WORKFLOWS_DIR = path.join(__dirname, '../../../../.github/workflows');

// The env keys any of the four boot guards read, plus the two the guard
// config derives them from. Everything else in a workflow env (secrets,
// VITE_ build vars, DATABASE_URL) is irrelevant to whether a boot is
// refused, and several of those carry ${{ …teger }} expressions no unit
// test should try to evaluate.
const GUARD_KEYS = [
  'NODE_ENV',
  'PAYMENTS_MODE',
  'SMS_MODE',
  'SMS_COMMAND_TIER',
  'E2E_FAKE_PAYMENTS',
  'SIMULATED_FAILURE_MODE',
  'ALLOW_SIMULATED_IN_PROD',
  'FLW_SECRET_KEY',
  'AT_API_KEY',
] as const;

/**
 * Extract every `env:` mapping in a workflow file as flat string maps.
 *
 * Deliberately not a YAML library: the repo carries none, and the env
 * blocks these files use are flat `KEY: value` maps under an `env:` line
 * — the one shape this parser accepts. Anything it cannot read (a nested
 * value, a list) simply ends the block, which fails safe: an unread key
 * resolves to its schema default, exactly what an unread key does at
 * boot. The e2e assertions at the bottom prove the extractor actually
 * reads the file it matters most for.
 */
function extractEnvBlocks(source: string): Array<Record<string, string>> {
  const lines = source.split('\n');
  const blocks: Array<Record<string, string>> = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^(\s*)env:\s*$/);
    if (!m) continue;
    const baseIndent = m[1].length;
    const block: Record<string, string> = {};
    for (let j = i + 1; j < lines.length; j += 1) {
      const line = lines[j];
      if (line.trim() === '' || line.trim().startsWith('#')) continue;
      const indent = line.match(/^(\s*)/)![1].length;
      if (indent <= baseIndent) break;
      const kv = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
      if (!kv) break;
      let value = kv[2].trim();
      // Strip one layer of quotes ('1' / "false") — workflow env values
      // are always strings, quoted or not.
      const q = value.match(/^'(.*)'$/) ?? value.match(/^"(.*)"$/);
      if (q) value = q[1];
      block[kv[1]] = value;
    }
    if (Object.keys(block).length > 0) blocks.push(block);
  }
  return blocks;
}

/** Resolve a declared env through the real schema defaults, guards' slice only. */
function resolveGuardConfig(declared: Record<string, string>) {
  const picked: Record<string, string> = {};
  for (const key of GUARD_KEYS) {
    if (declared[key] !== undefined) picked[key] = declared[key];
  }
  const shape = (envSchema as unknown as { shape: Record<string, { parse(v: unknown): unknown }> })
    .shape;
  const out: Record<string, unknown> = {};
  for (const key of GUARD_KEYS) {
    out[key] = shape[key].parse(picked[key]);
  }
  return out as {
    NODE_ENV: 'development' | 'production' | 'test';
    PAYMENTS_MODE: 'live' | 'simulated';
    SMS_MODE: 'live' | 'simulated';
    SMS_COMMAND_TIER: 'safe' | 'full';
    E2E_FAKE_PAYMENTS: '0' | '1';
    SIMULATED_FAILURE_MODE: string;
    ALLOW_SIMULATED_IN_PROD: boolean;
    FLW_SECRET_KEY: string;
    AT_API_KEY: string;
  };
}

function bootGuards(cfg: ReturnType<typeof resolveGuardConfig>): void {
  assertSimulationModeSafety(cfg);
  assertSmsTransportSafety(cfg);
  assertSmsCommandTierSafety(cfg);
  assertFakePaymentsSafety(cfg);
}

const workflowFiles = fs
  .readdirSync(WORKFLOWS_DIR)
  .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
  .sort();

describe('CI boot combos — every env a workflow declares must pass the startup guards', () => {
  test('the workflows directory is where this test thinks it is', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    expect(workflowFiles).toContain('e2e.yml');
  });

  for (const file of workflowFiles) {
    test(`${file}: every declared env block boots`, () => {
      const source = fs.readFileSync(path.join(WORKFLOWS_DIR, file), 'utf8');
      const blocks = extractEnvBlocks(source);
      for (const block of blocks) {
        // A combination that any startup guard refuses would take this
        // workflow's server down at boot — or lie in wait for the day
        // the job grows a boot step.
        expect(() => bootGuards(resolveGuardConfig(block))).not.toThrow();
      }
    });
  }

  test('declaring the hatch means declaring the mode — no silent default under E2E_FAKE_PAYMENTS', () => {
    // The regression this whole file exists for: a job may only carry
    // E2E_FAKE_PAYMENTS if it SAYS which payments mode it means. The
    // default 'live' is precisely the value the guard refuses next to
    // the hatch, and a default is not a declaration.
    for (const file of workflowFiles) {
      const source = fs.readFileSync(path.join(WORKFLOWS_DIR, file), 'utf8');
      for (const block of extractEnvBlocks(source)) {
        if (block.E2E_FAKE_PAYMENTS !== undefined) {
          expect(block.PAYMENTS_MODE).toBeDefined();
        }
      }
    }
  });

  test('the extractor reads the e2e job as CI will run it', () => {
    const source = fs.readFileSync(path.join(WORKFLOWS_DIR, 'e2e.yml'), 'utf8');
    const blocks = extractEnvBlocks(source);
    const e2e = blocks.find((b) => b.E2E_FAKE_PAYMENTS !== undefined);
    expect(e2e).toBeDefined();
    // The declared truth of that job, pinned: the fake gateway, named.
    expect(e2e!.PAYMENTS_MODE).toBe('simulated');
    expect(e2e!.E2E_FAKE_PAYMENTS).toBe('1');
    expect(e2e!.NODE_ENV).toBe('test');
    expect(e2e!.SMS_MODE).toBe('live');
    // And no real gateway key beside the fake (the sim-mode guard's own
    // rule, asserted against the file rather than trusted).
    expect(e2e!.FLW_SECRET_KEY).toBeUndefined();
  });
});
