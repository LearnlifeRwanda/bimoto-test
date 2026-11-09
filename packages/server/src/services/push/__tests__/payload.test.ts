jest.mock('../../../prisma', () => ({
  __esModule: true,
  default: {
    user: { findUnique: jest.fn() },
  },
}));

import prisma from '../../../prisma';
import { buildPushPayload, getUserLanguage } from '../payload';

const findUnique = (prisma as any).user.findUnique as jest.Mock;

describe('buildPushPayload', () => {
  test('renders English title/body for en locale', () => {
    const p = buildPushPayload('bidReceived', {
      language: 'en' as any,
      data: { type: 'bid', journeyId: 'j1', bidId: 'b1' },
    });
    expect(p.title).toBe('New bid');
    expect(p.body).toContain('driver');
    expect(p.data).toEqual({ type: 'bid', journeyId: 'j1', bidId: 'b1' });
  });

  test('renders Kinyarwanda title for rw locale', () => {
    const p = buildPushPayload('journeyStarted', {
      language: 'rw' as any,
      data: { type: 'journey', journeyId: 'j1' },
    });
    expect(p.title).toBe('Urugendo rwatangiye');
  });

  test('renders French title for fr locale', () => {
    const p = buildPushPayload('escrowReleased', {
      language: 'fr' as any,
      data: { type: 'escrow', journeyId: 'j1' },
      vars: { amount: 5000 },
    });
    expect(p.title).toBe('Paiement reçu');
    expect(p.body).toContain('5000');
  });

  test('falls back to English for unknown language code', () => {
    const p = buildPushPayload('newMessage', {
      language: 'xx' as any,
      data: { type: 'message', journeyId: 'j1' },
      vars: { sender: 'Alice', preview: 'hi' },
    });
    expect(p.title).toContain('Alice');
  });

  test('interpolates {var} placeholders from vars map', () => {
    const p = buildPushPayload('ratingReceived', {
      language: 'en' as any,
      data: { type: 'rating', journeyId: 'j1' },
      vars: { stars: 5 },
    });
    expect(p.title).toBe('New 5-star rating');
  });
});

describe('getUserLanguage', () => {
  beforeEach(() => jest.clearAllMocks());

  test("returns the user's stored language", async () => {
    findUnique.mockResolvedValue({ language: 'rw' });
    const lang = await getUserLanguage('user-1');
    expect(lang).toBe('rw');
  });

  test('falls back to en if user not found', async () => {
    findUnique.mockResolvedValue(null);
    const lang = await getUserLanguage('user-1');
    expect(lang).toBe('en');
  });

  test('falls back to en if DB query throws', async () => {
    findUnique.mockRejectedValue(new Error('db down'));
    const lang = await getUserLanguage('user-1');
    expect(lang).toBe('en');
  });
});
