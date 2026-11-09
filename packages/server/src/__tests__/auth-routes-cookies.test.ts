// PREPROTO-AUTH G4 — session cookie flags are driven by COOKIE_SECURE,
// not NODE_ENV: a dev-mode server behind an HTTPS tunnel still issues
// Secure httpOnly cookies.

jest.mock('../config', () => ({
  config: {
    COOKIE_SECURE: true,
    OTP_MAX_ATTEMPTS: 5,
    JWT_SECRET: 'test-jwt-secret-at-least-16-chars',
    JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-16-chars',
    ENCRYPTION_KEY: 'a'.repeat(64),
    OTP_HMAC_KEY: undefined,
    NODE_ENV: 'test',
  },
}));

jest.mock('../services/auth.service', () => ({
  requestOtp: jest.fn(),
  verifyOtp: jest.fn(),
  refreshTokens: jest.fn(),
  revokeSession: jest.fn(),
}));

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import authRoutes from '../routes/auth.routes';
import * as authService from '../services/auth.service';

const verifyOtp = authService.verifyOtp as jest.Mock;
const refreshTokens = authService.refreshTokens as jest.Mock;
const revokeSession = authService.revokeSession as jest.Mock;

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRoutes);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('session cookie flags (G4)', () => {
  test('verify-otp sets Secure, HttpOnly, SameSite=Lax cookies when COOKIE_SECURE=true', async () => {
    verifyOtp.mockResolvedValue({
      user: { id: 'u1', role: 'CUSTOMER' },
      isNewUser: false,
      accessToken: 'access-token-value',
      refreshToken: 'refresh-token-value',
    });

    const res = await request(makeApp())
      .post('/api/auth/verify-otp')
      .send({ phone: '+250788123456', otp: '123456' });

    expect(res.status).toBe(200);
    const cookies = res.headers['set-cookie'] as unknown as string[];
    expect(cookies).toHaveLength(2);
    for (const cookie of cookies) {
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/Secure/i);
      expect(cookie).toMatch(/SameSite=Lax/i);
    }
  });

  test('refresh sets the same hardened flags', async () => {
    refreshTokens.mockResolvedValue({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
    });

    const res = await request(makeApp())
      .post('/api/auth/refresh')
      .set('Cookie', ['refreshToken=old-refresh']);

    expect(res.status).toBe(200);
    const cookies = res.headers['set-cookie'] as unknown as string[];
    expect(cookies).toHaveLength(2);
    for (const cookie of cookies) {
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/Secure/i);
    }
  });

  test('logout revokes the presented refresh token server-side and clears cookies', async () => {
    const res = await request(makeApp())
      .post('/api/auth/logout')
      .set('Cookie', ['refreshToken=the-refresh-token']);

    expect(res.status).toBe(200);
    expect(revokeSession).toHaveBeenCalledWith('the-refresh-token');
    const cookies = res.headers['set-cookie'] as unknown as string[];
    expect(cookies.some((c) => c.startsWith('accessToken=;'))).toBe(true);
    expect(cookies.some((c) => c.startsWith('refreshToken=;'))).toBe(true);
  });
});
