jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    $queryRaw: jest.fn(),
  },
}));

jest.mock('@sentry/node', () => ({
  captureException: jest.fn(),
}));

import express from 'express';
import request from 'supertest';
import prisma from '../prisma';
import * as Sentry from '@sentry/node';
import healthRoutes from '../routes/health.routes';
import { _setExecForTests, _setReadFileForTests } from '../services/build-identity';

const app = express();
app.use('/api', healthRoutes);

const queryRaw = (prisma as any).$queryRaw as jest.Mock;
const captureException = Sentry.captureException as jest.Mock;

describe('GET /api/health', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.RENDER_GIT_COMMIT;
    delete process.env.BUILD_SHA;
    // Default seam: behave like the pilot's zip deploy — no .git, git fails.
    _setExecForTests((() => {
      throw new Error('not a git repository');
    }) as unknown as Parameters<typeof _setExecForTests>[0]);
    // MATCH-CLOSE G4 — and no BUILD_SHA stamp file either. Without this
    // the stamp a developer's own tree carries (written by
    // stamp-build-sha.command) would answer these cases instead.
    _setReadFileForTests(() => {
      throw new Error('ENOENT');
    });
  });

  afterAll(() => {
    _setExecForTests(null);
    _setReadFileForTests(null);
  });

  test('200 with status:ok when DB is reachable', async () => {
    queryRaw.mockResolvedValueOnce([{ '?column?': 1 }]);
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.dbConnected).toBe(true);
    expect(captureException).not.toHaveBeenCalled();
  });

  test('200 with status:degraded when DB throws', async () => {
    queryRaw.mockRejectedValueOnce(new Error('connection refused'));
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('degraded');
    expect(res.body.dbConnected).toBe(false);
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException.mock.calls[0][1]).toEqual({ tags: { route: 'health' } });
  });

  // FIELD-UX G5 — the old default was 'dev', which read as intentional on
  // the pilot. Resolution: BUILD_SHA → RENDER_GIT_COMMIT → git → 'unknown'.
  test('response includes uptime, timestamp, and version "unknown" when nothing identifies the build', async () => {
    queryRaw.mockResolvedValueOnce([{ '?column?': 1 }]);
    const res = await request(app).get('/api/health');
    expect(typeof res.body.uptime).toBe('number');
    expect(res.body.uptime).toBeGreaterThanOrEqual(0);
    expect(typeof res.body.timestamp).toBe('string');
    expect(() => new Date(res.body.timestamp).toISOString()).not.toThrow();
    expect(res.body.version).toBe('unknown');
  });

  test('version is the 7-char short SHA when BUILD_SHA is set (release bundles)', async () => {
    queryRaw.mockResolvedValueOnce([{ '?column?': 1 }]);
    process.env.BUILD_SHA = '1234567890abcdef1234567890abcdef12345678';
    const res = await request(app).get('/api/health');
    expect(res.body.version).toBe('1234567');
  });

  test('version is the 7-char short SHA when RENDER_GIT_COMMIT is set', async () => {
    queryRaw.mockResolvedValueOnce([{ '?column?': 1 }]);
    process.env.RENDER_GIT_COMMIT = 'abcdef1234567890abcdef1234567890abcdef12';
    const res = await request(app).get('/api/health');
    expect(res.body.version).toBe('abcdef1');
  });

  test('BUILD_SHA wins over RENDER_GIT_COMMIT', async () => {
    queryRaw.mockResolvedValueOnce([{ '?column?': 1 }]);
    process.env.BUILD_SHA = '1234567890abcdef1234567890abcdef12345678';
    process.env.RENDER_GIT_COMMIT = 'abcdef1234567890abcdef1234567890abcdef12';
    const res = await request(app).get('/api/health');
    expect(res.body.version).toBe('1234567');
  });

  test('falls back to git rev-parse when no env var is set and a .git checkout exists', async () => {
    queryRaw.mockResolvedValueOnce([{ '?column?': 1 }]);
    _setExecForTests(
      (() => Buffer.from('793a859\n')) as unknown as Parameters<typeof _setExecForTests>[0],
    );
    const res = await request(app).get('/api/health');
    expect(res.body.version).toBe('793a859');
  });

  // MATCH-CLOSE G4 — the rung the Kigali install actually lands on: an
  // unzipped bundle with no .git and no env var, carrying the BUILD_SHA
  // file that stamp-build-sha.command wrote and update-pilot.command
  // placed.
  test('falls back to the BUILD_SHA stamp file when no env var is set and there is no .git', async () => {
    _setReadFileForTests(() => '4295361\n');
    queryRaw.mockResolvedValueOnce([{ '?column?': 1 }]);
    const res = await request(app).get('/api/health');
    expect(res.body.version).toBe('4295361');
  });

  test('a blank stamp file is treated as no stamp at all', async () => {
    _setReadFileForTests(() => '   \n');
    queryRaw.mockResolvedValueOnce([{ '?column?': 1 }]);
    const res = await request(app).get('/api/health');
    expect(res.body.version).toBe('unknown');
  });

  test('reports paymentsMode and smsMode (live defaults in test config)', async () => {
    queryRaw.mockResolvedValueOnce([{ '?column?': 1 }]);
    const res = await request(app).get('/api/health');
    expect(res.body.paymentsMode).toBe('live');
    expect(res.body.smsMode).toBe('live');
  });
});
