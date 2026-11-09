// PREPROTO-SIM G5 — quality gate: with both modes simulated, exercising
// the payment AND SMS seams end-to-end constructs NEITHER real vendor
// SDK. Both vendor modules are mocked as throwing constructors, so any
// code path that so much as instantiates them fails this suite loudly.

jest.mock('../config', () => ({
  config: {
    DATABASE_URL: 'test',
    JWT_SECRET: 'test-jwt-secret-at-least-16-chars',
    JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-16-chars',
    ENCRYPTION_KEY: 'a'.repeat(64),
    PORT: 3000,
    CLIENT_URL: 'http://localhost:5173',
    NODE_ENV: 'test',
    PAYMENTS_MODE: 'simulated',
    SMS_MODE: 'simulated',
    FLW_SECRET_KEY: '',
    SIM_INBOX_TOKEN: '',
    ALLOW_SIMULATED_IN_PROD: false,
  },
}));

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    simulatedMessage: {
      create: jest.fn().mockResolvedValue({ id: 'sm-1' }),
    },
  },
}));

jest.mock('flutterwave-node-v3', () =>
  jest.fn(() => {
    throw new Error('QUALITY GATE: flutterwave-node-v3 constructed in simulated mode');
  }),
);

jest.mock('africastalking', () =>
  jest.fn(() => {
    throw new Error('QUALITY GATE: africastalking constructed in simulated mode');
  }),
);

import { resetClientForTests } from '../services/payment/flutterwave-client';
import { chargeMomo } from '../services/payment/charge';
import { transferToWallet } from '../services/payment/transfer';
import { sendSms } from '../services/sms.service';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Flutterwave = require('flutterwave-node-v3');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const AfricasTalking = require('africastalking');

describe('PREPROTO-SIM quality gate — no real vendor SDK in simulated modes', () => {
  beforeEach(() => {
    resetClientForTests();
    (Flutterwave as jest.Mock).mockClear();
    (AfricasTalking as jest.Mock).mockClear();
  });

  test('a full simulated charge + payout + SMS constructs neither SDK', async () => {
    const charge = await chargeMomo({
      phone: '+250788123456',
      amount: 2000,
      txRef: 'gate-1',
      narration: 'quality gate',
    });
    expect(charge.status).toBe('SUCCESS');

    const transfer = await transferToWallet({
      phone: '+250789876543',
      amount: 1425,
      narration: 'quality gate payout',
      reference: 'gate-payout-1',
    });
    expect(transfer.status).toBe('SUCCESS');

    const sms = await sendSms('+250781234567', 'quality gate message');
    expect(sms.success).toBe(true);

    expect(Flutterwave).not.toHaveBeenCalled();
    expect(AfricasTalking).not.toHaveBeenCalled();
  });

  test('even with FLW env keys present, simulated mode never builds the real client', async () => {
    // Belt-and-suspenders: the startup guard forbids this combination for
    // a real boot, but getClient() itself must also never reach the SDK.
    process.env.FLW_PUBLIC_KEY = 'FLWPUBK-x';
    process.env.FLW_SECRET_KEY = 'FLWSECK-x';
    try {
      const charge = await chargeMomo({
        phone: '+250788123456',
        amount: 1000,
        txRef: 'gate-2',
        narration: 'quality gate',
      });
      expect(charge.status).toBe('SUCCESS');
      expect(Flutterwave).not.toHaveBeenCalled();
    } finally {
      delete process.env.FLW_PUBLIC_KEY;
      delete process.env.FLW_SECRET_KEY;
    }
  });
});
