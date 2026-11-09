// PILOT-GUARD Item 7 — the pilot's own logs stop printing whole numbers.
//
// #180 masked the LIVE branch. The three branches above it did not, and
// one of them is the branch a keyless pilot actually runs:
// startup-guard.ts recommends SMS_MODE=simulated as "the escape hatch
// for a keyless pilot", and that branch printed
// `[SMS-SIM] Captured message to +250788123456`. Every OTP, freeze
// notice and ride reminder put a subscriber's full number into stdout —
// Render's log stream, a rotated file, a screenshot — undoing at the
// terminal exactly what phoneEncrypted does at rest.
//
// The SimulatedMessage ROW is deliberately unchanged: the inbox has to
// be dialable, and it is guarded by SIM_INBOX_TOKEN. This is a log-only
// change, and the row assertion below is what pins that.

const simulatedMessageCreate = jest.fn().mockResolvedValue({});

jest.mock('../prisma', () => ({
  __esModule: true,
  default: { simulatedMessage: { create: simulatedMessageCreate } },
}));

const mockConfig: { SMS_MODE: 'live' | 'simulated' } = { SMS_MODE: 'simulated' };
jest.mock('../config', () => ({ config: mockConfig }));

import { maskPhone, sendSms } from '../services/sms.service';

const PHONE = '+250788123456';
const OTHER = '+250788123999';
const OTP_BODY = 'Your Bimoto code is 4821';

let logs: string[] = [];
let logSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  logs = [];
  logSpy = jest.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(' '));
  });
});

afterEach(() => logSpy.mockRestore());

const printed = () => logs.join('\n');

describe('SMS-SIM branch — the mode a keyless pilot runs', () => {
  beforeEach(() => {
    mockConfig.SMS_MODE = 'simulated';
  });

  test('the log line carries no whole number', async () => {
    await sendSms(PHONE, OTP_BODY);
    expect(printed()).toContain('[SMS-SIM]');
    expect(printed()).not.toContain(PHONE);
    expect(printed()).not.toContain('788123456');
    expect(printed()).toContain(maskPhone(PHONE));
  });

  test('the log line still tells two recipients apart', async () => {
    await sendSms(PHONE, OTP_BODY);
    const first = printed();
    logs = [];
    await sendSms(OTHER, OTP_BODY);
    expect(first).not.toBe(printed());
  });

  test('the SimulatedMessage ROW is unchanged — the inbox stays dialable', async () => {
    await sendSms(PHONE, OTP_BODY);
    expect(simulatedMessageCreate).toHaveBeenCalledWith({
      data: { toPhone: PHONE, body: OTP_BODY },
    });
  });

  test('the body is still withheld from the log', async () => {
    await sendSms(PHONE, OTP_BODY);
    expect(printed()).not.toContain('4821');
  });
});

describe('SMS-TEST branch — what CI and a developer terminal show', () => {
  beforeEach(() => {
    mockConfig.SMS_MODE = 'live';
    process.env.NODE_ENV = 'test';
  });

  test('the log line carries no whole number', async () => {
    await sendSms(PHONE, OTP_BODY);
    expect(printed()).toContain('[SMS-TEST]');
    expect(printed()).not.toContain(PHONE);
    expect(printed()).toContain(maskPhone(PHONE));
  });
});

describe('SMS-DEV branch', () => {
  const prevEnv = process.env.NODE_ENV;

  beforeEach(() => {
    mockConfig.SMS_MODE = 'live';
    process.env.NODE_ENV = 'development';
  });

  afterEach(() => {
    process.env.NODE_ENV = prevEnv;
  });

  test('the destination is masked, as the body already was', async () => {
    await sendSms(PHONE, OTP_BODY);
    expect(printed()).toContain('[SMS-DEV]');
    expect(printed()).not.toContain(PHONE);
    expect(printed()).toContain(maskPhone(PHONE));
    expect(printed()).toContain('body withheld');
  });
});

describe('no branch of sendSms prints a whole number', () => {
  test('the source has no unmasked ${phone} interpolation in a log call', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../services/sms.service.ts'),
      'utf8',
    );
    const consoleLines = src
      .split('\n')
      .filter((l: string) => /console\.(log|warn|error)/.test(l) || /\$\{phone\}/.test(l))
      .filter((l: string) => !l.trimStart().startsWith('//'));
    for (const line of consoleLines) {
      expect(line).not.toMatch(/\$\{phone\}/);
    }
  });
});
