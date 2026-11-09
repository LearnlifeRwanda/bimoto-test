// PILOT-GUARD Item 6(a) — the chat POST validates its body.
//
// routes/message.routes.ts imported `validate` and `createMessageSchema`
// at the top of the file and applied neither to POST
// /api/journeys/:id/messages. A request with no body reached
// `const { text, ... } = req.body`, threw a TypeError on undefined, and
// came back to the phone as 500 INTERNAL_ERROR — "Bimoto has a problem,
// not your phone", for a request the server was right to refuse.
//
// The pairing that matters is the third test: `journeyId` is required by
// the shared schema and has never been sent in the body by anything (the
// client, and both e2e specs that post here, send `{ text }`), so
// validating the schema unmodified would have turned every real chat
// message into a 400. That is why the route omits it — the path
// parameter already names the journey.

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    journey: { findUnique: jest.fn() },
    message: { create: jest.fn(), findMany: jest.fn() },
  },
}));

jest.mock('../config', () => ({
  config: {
    JWT_SECRET: 'test-jwt-secret-at-least-32-chars-padding-padding',
    JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-32-chars-padding',
    ENCRYPTION_KEY: 'a'.repeat(64),
    NODE_ENV: 'test',
  },
}));

jest.mock('../socket', () => ({ emitToJourney: jest.fn() }));

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import prisma from '../prisma';
import messageRoutes from '../routes/message.routes';
import { errorHandler } from '../middleware/error-handler';
import { generateAccessToken } from '../utils/jwt';

const app = express();
app.use(cookieParser());
app.use(express.json());
app.use('/api/journeys', messageRoutes);
app.use(errorHandler);

const CUSTOMER = '11111111-1111-1111-1111-111111111111';
const JOURNEY = '22222222-2222-2222-2222-222222222222';
const token = generateAccessToken({ userId: CUSTOMER, role: 'CUSTOMER' });

const post = (body?: unknown) => {
  const req = request(app)
    .post(`/api/journeys/${JOURNEY}/messages`)
    .set('Cookie', [`accessToken=${token}`]);
  return body === undefined ? req.send() : req.send(body as object);
};

beforeEach(() => {
  jest.clearAllMocks();
  (prisma as any).journey.findUnique.mockResolvedValue({
    id: JOURNEY,
    customerId: CUSTOMER,
    driverId: 'd1',
    status: 'MATCHED',
  });
  (prisma as any).message.create.mockImplementation(async ({ data }: any) => ({
    id: 'm1',
    createdAt: new Date(),
    ...data,
  }));
});

describe('POST /api/journeys/:id/messages — the body is validated', () => {
  test('no body is a 400 VALIDATION_ERROR, not a 500', async () => {
    const res = await post();
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect((prisma as any).message.create).not.toHaveBeenCalled();
  });

  test('an empty object is a 400 — `text` is required', async () => {
    const res = await post({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('an empty string is a 400', async () => {
    const res = await post({ text: '' });
    expect(res.status).toBe(400);
  });

  test('a wrong-typed field is a 400', async () => {
    const res = await post({ text: 'hello', isQuickMessage: 'yes' });
    expect(res.status).toBe(400);
  });

  // The pairing: what every real caller actually sends must still work.
  test('the shape the client and both e2e specs send — { text } — is a 201', async () => {
    const res = await post({ text: 'I am at the gate' });
    expect(res.status).toBe(201);
    expect((prisma as any).message.create).toHaveBeenCalledTimes(1);
  });

  test('a quick message still works', async () => {
    const res = await post({
      text: 'On my way',
      isQuickMessage: true,
      quickMessageId: 'driver_on_the_way',
    });
    expect(res.status).toBe(201);
  });

  test('a body that DOES carry journeyId is still accepted', async () => {
    // `.omit` drops the key from the schema; zod objects are permissive
    // by default, so an old client sending it is not punished for it.
    const res = await post({ journeyId: JOURNEY, text: 'hello' });
    expect(res.status).toBe(201);
  });
});
