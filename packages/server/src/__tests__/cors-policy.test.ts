// PREPROTO-AUTH G5 — CORS allow-list + trust-proxy parsing. An unlisted
// browser origin gets a hard 403; the Origin header is never reflected.

jest.mock('../config', () => ({
  config: {
    CLIENT_URL: 'http://localhost:5173',
    CORS_ORIGINS: 'http://localhost:5173, https://app.bimoto.rw,https://localhost',
    NODE_ENV: 'test',
  },
}));

import express from 'express';
import cors from 'cors';
import request from 'supertest';
import { allowedOrigins, corsOriginCheck, parseTrustProxy } from '../middleware/cors-policy';
import { errorHandler } from '../middleware/error-handler';

describe('allowedOrigins', () => {
  test('parses the comma-separated list (trimming whitespace)', () => {
    expect(allowedOrigins()).toEqual([
      'http://localhost:5173',
      'https://app.bimoto.rw',
      'https://localhost',
    ]);
  });
});

describe('CORS middleware behaviour', () => {
  function makeApp() {
    const app = express();
    app.use(cors({ origin: corsOriginCheck, credentials: true }));
    app.get('/ping', (_req, res) => {
      res.json({ ok: true });
    });
    app.use(errorHandler);
    return app;
  }

  test('allows a listed origin and echoes it (not a wildcard) with credentials', async () => {
    const res = await request(makeApp()).get('/ping').set('Origin', 'https://app.bimoto.rw');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('https://app.bimoto.rw');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  test('rejects an unlisted origin with 403 and never reflects it', async () => {
    const res = await request(makeApp()).get('/ping').set('Origin', 'https://evil.example.com');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CORS_ORIGIN_FORBIDDEN');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('rejects an unlisted origin on preflight', async () => {
    const res = await request(makeApp())
      .options('/ping')
      .set('Origin', 'https://evil.example.com')
      .set('Access-Control-Request-Method', 'GET');
    expect(res.status).toBe(403);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('requests without an Origin header (non-browser clients) pass', async () => {
    const res = await request(makeApp()).get('/ping');
    expect(res.status).toBe(200);
  });
});

describe('parseTrustProxy', () => {
  test("'false' and empty disable proxy trust", () => {
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('')).toBe(false);
    expect(parseTrustProxy('  ')).toBe(false);
  });

  test("'true' trusts exactly one hop — never express's trust-everything mode", () => {
    expect(parseTrustProxy('true')).toBe(1);
  });

  test('numbers and presets pass through', () => {
    expect(parseTrustProxy('2')).toBe(2);
    expect(parseTrustProxy('loopback')).toBe('loopback');
  });
});
