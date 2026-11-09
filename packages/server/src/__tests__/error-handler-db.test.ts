// DB-RESILIENCE G6 — a database outage must read as "service
// unavailable" (503 DATABASE_UNAVAILABLE), never as a generic bug
// (500 INTERNAL_ERROR); everything else keeps its old mapping.

import express from 'express';
import request from 'supertest';
import { AppError, errorHandler } from '../middleware/error-handler';

function appThrowing(err: Error) {
  const app = express();
  app.get('/boom', (_req, _res, next) => next(err));
  app.use(errorHandler);
  return app;
}

function p1001(): Error {
  const err = new Error("Can't reach database server at `localhost:5432`");
  (err as Error & { code: string }).code = 'P1001';
  return err;
}

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('errorHandler — database unreachable', () => {
  test('P1001 answers 503 DATABASE_UNAVAILABLE with the honest i18n key', async () => {
    const res = await request(appThrowing(p1001())).get('/boom');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('DATABASE_UNAVAILABLE');
    expect(res.body.error.message).toBe('errors.serverProblem');
  });

  test('a P1001-shaped initialization error (errorCode) also maps to 503', async () => {
    const err = new Error("Can't reach database server at `localhost:5432`");
    (err as Error & { errorCode: string }).errorCode = 'P1001';
    const res = await request(appThrowing(err)).get('/boom');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('DATABASE_UNAVAILABLE');
  });

  test('other errors stay 500 INTERNAL_ERROR', async () => {
    const res = await request(appThrowing(new Error('null deref'))).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(res.body.error.message).toBe('errors.generic');
  });

  test('P1017 (dead pooled socket) also answers 503 — a status mapping is not a retry', async () => {
    const err = new Error('Server has closed the connection.');
    (err as Error & { code: string }).code = 'P1017';
    const res = await request(appThrowing(err)).get('/boom');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('DATABASE_UNAVAILABLE');
  });

  test('AppError keeps its own status and code', async () => {
    const res = await request(
      appThrowing(new AppError(404, 'JOURNEY_NOT_FOUND', 'errors.journeyNotFound')),
    ).get('/boom');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('JOURNEY_NOT_FOUND');
  });
});
