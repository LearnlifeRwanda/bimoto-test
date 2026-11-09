// PREPROTO-AUTH G4 — JWT algorithm pinning, secret floors, and
// COOKIE_SECURE-driven cookie flags.

import jwt from 'jsonwebtoken';
import { generateAccessToken, verifyAccessToken, verifyRefreshToken } from '../utils/jwt';
import { config } from '../config';

describe('JWT algorithm pinning (G4)', () => {
  test('round-trip with the issued HS256 token works', () => {
    const token = generateAccessToken({ userId: 'u1', role: 'CUSTOMER' });
    expect(verifyAccessToken(token).userId).toBe('u1');
  });

  test('rejects a token signed with a different HMAC variant (HS512, same secret)', () => {
    const forged = jwt.sign({ userId: 'u1', role: 'ADMIN' }, config.JWT_SECRET, {
      algorithm: 'HS512',
      expiresIn: '15m',
    });
    expect(() => verifyAccessToken(forged)).toThrow();
  });

  test('rejects an unsigned (alg: none) token', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ userId: 'u1', role: 'ADMIN', exp: Math.floor(Date.now() / 1000) + 900 }),
    ).toString('base64url');
    expect(() => verifyAccessToken(`${header}.${payload}.`)).toThrow();
  });

  test('refresh verifier is pinned too', () => {
    const forged = jwt.sign({ userId: 'u1', role: 'ADMIN', jti: 'x' }, config.JWT_REFRESH_SECRET, {
      algorithm: 'HS384',
    });
    expect(() => verifyRefreshToken(forged)).toThrow();
  });
});

describe('config fail-closed on weak/default secrets (G4)', () => {
  const ORIGINAL_ENV = process.env;
  const validBase = {
    DATABASE_URL: 'postgresql://x:x@localhost:5432/x',
    JWT_SECRET: 'f'.repeat(64),
    JWT_REFRESH_SECRET: 'e'.repeat(64),
    ENCRYPTION_KEY: 'a'.repeat(64),
    NODE_ENV: 'production',
  };

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    jest.restoreAllMocks();
  });

  function loadWith(env: Record<string, string>): { exited: boolean } {
    let exited = false;
    jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      exited = true;
      throw new Error(`process.exit(${code})`);
    }) as never);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    process.env = { ...env } as NodeJS.ProcessEnv;
    jest.isolateModules(() => {
      try {
        require('../config');
      } catch {
        // exit-throw from the spy
      }
    });
    return { exited };
  }

  test('accepts strong secrets', () => {
    expect(loadWith(validBase).exited).toBe(false);
  });

  test('refuses a JWT_SECRET shorter than 32 chars', () => {
    expect(loadWith({ ...validBase, JWT_SECRET: 'short-secret' }).exited).toBe(true);
  });

  test('refuses the .env.example placeholder secret', () => {
    expect(
      loadWith({ ...validBase, JWT_SECRET: 'change-this-to-a-random-64-char-string' }).exited,
    ).toBe(true);
  });

  test('refuses a known-default refresh secret', () => {
    expect(
      loadWith({
        ...validBase,
        JWT_REFRESH_SECRET: 'change-this-to-a-different-random-64-char-string',
      }).exited,
    ).toBe(true);
  });

  test('refuses a set-but-weak OTP_HMAC_KEY (no silent downgrade)', () => {
    expect(loadWith({ ...validBase, OTP_HMAC_KEY: 'too-short' }).exited).toBe(true);
  });
});
