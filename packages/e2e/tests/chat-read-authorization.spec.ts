// AUTH-READ G3 — the case no chat spec had.
//
// Every existing chat spec reads as a participant, which is exactly why
// `GET /api/journeys/:id/messages` shipped with no user scope: the query
// was `where: { journeyId }`, so any authenticated account that knew or
// guessed a journey UUID read that journey's whole chat. The service
// unit test pins the same rule, but a mocked prisma cannot prove the
// query is actually scoped — this runs against the real database, which
// is where a where-clause either filters or does not.
//
// The third account here is deliberately a REAL, fully authenticated
// user (a seeded driver who simply is not on this journey), not an
// anonymous caller: the bug was never about authentication.

import { test, expect } from '@playwright/test';
import {
  loginAs,
  createPassengerJourney,
  submitBid,
  acceptBid,
  verifyDriver,
  disconnectPrisma,
} from './helpers';

test.afterAll(async () => {
  await disconnectPrisma();
});

test('a non-participant cannot read a journey chat', async () => {
  // 1. Two parties and one outsider, all logged in for real.
  const customer = await loginAs('TestCustomer');
  const driver = await loginAs('TestDriver');
  const stranger = await loginAs('EBikeJean');
  await verifyDriver('TestDriver');

  // 2. A matched journey, so both parties are on it.
  const journey = await createPassengerJourney(customer.api);
  const bid = await submitBid(driver.api, journey.id, 1500, 5);
  await acceptBid(customer.api, journey.id, bid.id);

  // 3. Real chat traffic, from both sides.
  const fromCustomer = await customer.api.post(`/api/journeys/${journey.id}/messages`, {
    data: { text: 'I am at the blue gate' },
  });
  expect(fromCustomer.status()).toBe(201);
  const fromDriver = await driver.api.post(`/api/journeys/${journey.id}/messages`, {
    data: { text: 'On my way' },
  });
  expect(fromDriver.status()).toBe(201);

  // 4. Both participants still read the whole thread — unchanged.
  for (const [who, session] of [
    ['customer', customer],
    ['driver', driver],
  ] as const) {
    const res = await session.api.get(`/api/journeys/${journey.id}/messages`);
    expect(res.status(), `${who} should still read the chat`).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(2);
    // Response shape for participants is byte-identical to before the
    // fix: the sender projection is part of the contract the chat UI
    // renders from.
    expect(body[0]).toMatchObject({
      journeyId: journey.id,
      text: 'I am at the blue gate',
      sender: { id: customer.user.id },
    });
    expect(body[1]).toMatchObject({ text: 'On my way' });
  }

  // 5. The outsider. This is the assertion the class was missing.
  const denied = await stranger.api.get(`/api/journeys/${journey.id}/messages`);
  expect(denied.status(), 'a non-participant must not read the chat').toBe(403);

  // Zero message rows — not "an error alongside the data". The raw body
  // is checked as text so that no array shape, however wrapped, can
  // smuggle a message through.
  const deniedText = await denied.text();
  expect(deniedText).not.toContain('I am at the blue gate');
  expect(deniedText).not.toContain('On my way');
  const deniedBody = JSON.parse(deniedText);
  expect(Array.isArray(deniedBody)).toBe(false);

  // 6. `since` is not a way around it — the guard runs before the query,
  //    so no variant of the read is left unscoped.
  const deniedSince = await stranger.api.get(
    `/api/journeys/${journey.id}/messages?since=2000-01-01T00:00:00.000Z`,
  );
  expect(deniedSince.status()).toBe(403);
  expect(await deniedSince.text()).not.toContain('On my way');

  // 7. A journey that does not exist is 404, per the journey route
  //    family's convention (`GET /:id/eta`, `GET /:id/emergency/active`).
  const missing = await stranger.api.get(
    '/api/journeys/00000000-0000-4000-8000-000000000000/messages',
  );
  expect(missing.status()).toBe(404);
});
