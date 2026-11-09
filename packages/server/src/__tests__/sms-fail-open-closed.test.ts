// GROUNDSKEEPER G2 — the SMS fail-open, and the evidence that it is shut.
//
// Before this dispatch, sms.service.ts chose its transport partly from
// whether AT_API_KEY was present:
//
//     if (!process.env.AT_API_KEY || NODE_ENV === 'development') {
//       console.log(`[SMS-DEV] To: ${phone} | Message: ${message}`);
//       return { success: true };
//     }
//
// On a production server with the key unset or misspelt that branch ran
// silently: every message — OTP issuance included — was printed to stdout
// and every caller was told `{ success: true }`. Two separate failures in
// one line: nothing was sent, and login codes were written to the server
// log in a codebase that encrypts phone numbers at rest.
//
// Three things have to stay true, and each has a test below.

import { assertSmsTransportSafety } from '../startup-guard';
import { maskPhone } from '../services/sms.service';

const base = {
  NODE_ENV: 'production' as const,
  SMS_MODE: 'live' as const,
  AT_API_KEY: 'atsk_real_key',
};

describe('assertSmsTransportSafety — a live transport that cannot send refuses to boot', () => {
  test('production + SMS_MODE=live + empty AT_API_KEY refuses to start', () => {
    expect(() => assertSmsTransportSafety({ ...base, AT_API_KEY: '' })).toThrow(
      /AT_API_KEY/,
    );
  });

  test('the refusal names the escape hatches rather than just failing', () => {
    expect(() => assertSmsTransportSafety({ ...base, AT_API_KEY: '' })).toThrow(
      /SMS_MODE=simulated/,
    );
  });

  // Whitespace is the shape a copy-pasted dashboard value actually takes,
  // and a key of spaces authenticates with nobody.
  test('a whitespace-only key is treated as absent', () => {
    expect(() => assertSmsTransportSafety({ ...base, AT_API_KEY: '   ' })).toThrow(
      /AT_API_KEY/,
    );
  });

  test('production + live + a real key boots', () => {
    expect(() => assertSmsTransportSafety(base)).not.toThrow();
  });

  // The keyless pilot has a supported route, and it is not "hope the log
  // is being read": SMS_MODE=simulated captures every message in the
  // /api/sim inbox, where an OTP can actually be looked up.
  test('production + SMS_MODE=simulated + no key boots', () => {
    expect(() =>
      assertSmsTransportSafety({ ...base, SMS_MODE: 'simulated', AT_API_KEY: '' }),
    ).not.toThrow();
  });

  // Development convenience is deliberately untouched: a developer with no
  // Africa's Talking account still has to be able to start the server.
  test('development with no key still boots', () => {
    expect(() =>
      assertSmsTransportSafety({ ...base, NODE_ENV: 'development', AT_API_KEY: '' }),
    ).not.toThrow();
  });

  test('test env with no key still boots', () => {
    expect(() =>
      assertSmsTransportSafety({ ...base, NODE_ENV: 'test', AT_API_KEY: '' }),
    ).not.toThrow();
  });
});

describe('maskPhone — the live path never prints a whole number', () => {
  test('keeps only the last three digits', () => {
    expect(maskPhone('+250788123456')).toBe('***456');
  });

  test('a masked number contains none of the leading digits', () => {
    const masked = maskPhone('+250788123456');
    expect(masked).not.toContain('250788');
    expect(masked).not.toContain('+');
  });

  test('two different recipients still read as different lines', () => {
    expect(maskPhone('+250788000001')).not.toBe(maskPhone('+250788000002'));
  });

  test('a value too short to mask reveals nothing at all', () => {
    expect(maskPhone('12')).toBe('***');
  });
});

// The regression this dispatch exists to prevent, asserted against the
// source itself: the transport decision must never read the credential
// again, and no branch may print a message body.
describe('sms.service source — the fail-open cannot come back', () => {
  const source = require('fs').readFileSync(
    require('path').resolve(__dirname, '..', 'services', 'sms.service.ts'),
    'utf8',
  ) as string;

  const code = source
    .split('\n')
    .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
    .join('\n');

  test('no branch condition tests AT_API_KEY for emptiness', () => {
    expect(code).not.toMatch(/if\s*\([^)]*!\s*(process\.env\.)?(config\.)?AT_API_KEY/);
  });

  // Every branch a real phone can reach must withhold the body. The
  // NODE_ENV==='test' branch is deliberately excluded and deliberately
  // unchanged: it runs only inside this jest process, where the "phone" is
  // a fixture and the log is scrollback nobody deploys. Widening the
  // withholding to it would have meant editing a branch this dispatch was
  // not sent to touch, and rewriting whatever asserts on its output.
  test('no reachable console line interpolates the message body', () => {
    const logLines = code
      .split('\n')
      .filter((l) => /console\.(log|error|warn)/.test(l))
      .filter((l) => !l.includes('[SMS-TEST]'));
    expect(logLines.length).toBeGreaterThan(0);
    for (const line of logLines) {
      expect(line).not.toMatch(/\$\{message\}/);
    }
  });

  test('the live-send log lines mask the recipient', () => {
    const liveLines = code
      .split('\n')
      .filter((l) => /console\.(log|error)\(`\[SMS\]/.test(l));
    expect(liveLines.length).toBe(2);
    for (const line of liveLines) {
      expect(line).toContain('maskPhone(phone)');
      expect(line).not.toMatch(/\$\{phone\}/);
    }
  });
});
