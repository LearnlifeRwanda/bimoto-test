// PREPROTO-SIM G3 — simulated SMS transport: messages are persisted to
// the inbox, Africa's Talking is never constructed, and the body (which
// may carry a login OTP) never reaches the process log.

jest.mock('../config', () => ({
  config: {
    DATABASE_URL: 'test',
    JWT_SECRET: 'test-jwt-secret-at-least-16-chars',
    JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-16-chars',
    ENCRYPTION_KEY: 'a'.repeat(64),
    PORT: 3000,
    CLIENT_URL: 'http://localhost:5173',
    NODE_ENV: 'test',
    PAYMENTS_MODE: 'live',
    SMS_MODE: 'simulated',
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

jest.mock('africastalking', () =>
  jest.fn(() => {
    throw new Error('africastalking must not be constructed in simulated mode');
  }),
);

import prisma from '../prisma';
import { sendSms } from '../services/sms.service';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const AfricasTalking = require('africastalking');

const createMock = (prisma as any).simulatedMessage.create as jest.Mock;

describe('sendSms under SMS_MODE=simulated', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('persists the message to the inbox and reports success', async () => {
    const r = await sendSms('+250781234567', 'Bimoto code: 123456. Expires in 10 min.');
    expect(r).toEqual({ success: true });
    expect(createMock).toHaveBeenCalledWith({
      data: {
        toPhone: '+250781234567',
        body: 'Bimoto code: 123456. Expires in 10 min.',
      },
    });
  });

  test('never constructs the Africa\'s Talking client', async () => {
    await sendSms('+250781234567', 'hello');
    expect(AfricasTalking).not.toHaveBeenCalled();
  });

  test('never writes the message body to the process log', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await sendSms('+250781234567', 'Bimoto code: 654321. Expires in 10 min.');
      for (const call of logSpy.mock.calls) {
        expect(String(call.join(' '))).not.toContain('654321');
      }
    } finally {
      logSpy.mockRestore();
    }
  });

  test('takes precedence over the NODE_ENV=test log branch (row is written even here)', async () => {
    // Jest runs with NODE_ENV=test; if the test branch ran first, no row
    // would ever be captured in a simulated-mode test environment.
    await sendSms('+250789876543', 'ride notification');
    expect(createMock).toHaveBeenCalledTimes(1);
  });
});
