// PREPROTO-SIM G3 — the inbox guard is an authentication surface (it
// delivers OTP codes). These tests pin the hard requirements: no
// unauthenticated read, ever; wrong token rejected; fail closed (503)
// when no token is configured; admin sessions accepted.

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
    SIM_INBOX_TOKEN: 'sim-inbox-token-0123456789abcdef-0123456789abcdef',
    ALLOW_SIMULATED_IN_PROD: false,
  },
}));

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    simulatedMessage: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  },
}));

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import prisma from '../prisma';
import { config } from '../config';
import simRoutes from '../routes/sim.routes';
import { generateAccessToken } from '../utils/jwt';
import { _resetRateLimitForTests } from '../middleware/rate-limit';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/sim', simRoutes);

const findMany = (prisma as any).simulatedMessage.findMany as jest.Mock;
const VALID_TOKEN = 'sim-inbox-token-0123456789abcdef-0123456789abcdef';

const sampleMessages = [
  {
    id: 'sm-2',
    toPhone: '+250781234567',
    body: 'Bimoto code: 123456. Expires in 10 min.',
    category: null,
    createdAt: new Date('2026-07-16T12:01:00Z'),
  },
  {
    id: 'sm-1',
    toPhone: '+250789876543',
    body: '<script>alert(1)</script> & "quotes"',
    category: null,
    createdAt: new Date('2026-07-16T12:00:00Z'),
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  _resetRateLimitForTests();
  (config as any).SIM_INBOX_TOKEN = VALID_TOKEN;
  findMany.mockResolvedValue(sampleMessages);
});

describe('sim inbox guard', () => {
  test.each(['/api/sim/messages', '/api/sim/inbox'])(
    'unauthenticated request to %s is rejected with 401 and serves no code',
    async (path) => {
      const res = await request(app).get(path);
      expect(res.status).toBe(401);
      expect(res.text).not.toContain('123456');
      expect(findMany).not.toHaveBeenCalled();
    },
  );

  test.each(['/api/sim/messages', '/api/sim/inbox'])(
    'wrong token on %s is rejected with 401 and serves no code',
    async (path) => {
      const res = await request(app).get(path).set('x-sim-inbox-token', 'wrong-token-wrong-token-wrong-token!');
      expect(res.status).toBe(401);
      expect(res.text).not.toContain('123456');
      expect(findMany).not.toHaveBeenCalled();
    },
  );

  test.each(['/api/sim/messages', '/api/sim/inbox'])(
    'fails closed with 503 on %s when no token is configured',
    async (path) => {
      (config as any).SIM_INBOX_TOKEN = '';
      const res = await request(app).get(path);
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('SIM_INBOX_NOT_CONFIGURED');
      expect(findMany).not.toHaveBeenCalled();
    },
  );

  test('non-admin session is rejected with 401', async () => {
    const customerToken = generateAccessToken({ userId: 'cust-1', role: 'CUSTOMER' });
    const res = await request(app)
      .get('/api/sim/messages')
      .set('Cookie', [`accessToken=${customerToken}`]);
    expect(res.status).toBe(401);
    expect(findMany).not.toHaveBeenCalled();
  });

  test('correct token grants access to the message list', async () => {
    const res = await request(app).get('/api/sim/messages').set('x-sim-inbox-token', VALID_TOKEN);
    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(2);
    expect(res.body.messages[0].body).toContain('123456');
  });

  test('admin session grants access without the token', async () => {
    const adminToken = generateAccessToken({ userId: 'adm-1', role: 'ADMIN' });
    const res = await request(app)
      .get('/api/sim/messages')
      .set('Cookie', [`accessToken=${adminToken}`]);
    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(2);
  });

  test('admin session works even when no token is configured (admin guard, not 503)', async () => {
    (config as any).SIM_INBOX_TOKEN = '';
    const adminToken = generateAccessToken({ userId: 'adm-1', role: 'ADMIN' });
    const res = await request(app)
      .get('/api/sim/messages')
      .set('Cookie', [`accessToken=${adminToken}`]);
    expect(res.status).toBe(200);
  });
});

describe('GET /api/sim/messages', () => {
  test('queries newest-first, capped, with optional recipient filter', async () => {
    await request(app)
      .get('/api/sim/messages')
      .query({ to: '2507812' })
      .set('x-sim-inbox-token', VALID_TOKEN);
    expect(findMany).toHaveBeenCalledWith({
      where: { toPhone: { contains: '2507812' } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  });
});

describe('GET /api/sim/inbox', () => {
  test('renders an HTML page with the messages, HTML-escaped', async () => {
    const res = await request(app).get('/api/sim/inbox').set('x-sim-inbox-token', VALID_TOKEN);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('Bimoto code: 123456');
    // Message bodies are attacker-influencable text — must be escaped.
    expect(res.text).not.toContain('<script>alert(1)</script>');
    expect(res.text).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(res.text).toContain('SIMULATION');
  });
});
