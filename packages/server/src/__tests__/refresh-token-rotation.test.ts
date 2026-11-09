// PREPROTO-AUTH G3 — revocable server-side sessions. In-memory
// RefreshToken table exercising the real auth.service + jwt + store:
// rotation, reuse-detection (reuse = theft revokes the family), logout
// revocation, and the live frozen check on refresh.

jest.mock('../prisma', () => {
  const refreshRows: any[] = [];
  const userRows = new Map<string, any>();
  const refreshToken = {
    create: jest.fn(async ({ data }: any) => {
      const row = { id: `rt-${refreshRows.length + 1}`, revokedAt: null, replacedByJti: null, createdAt: new Date(), ...data };
      refreshRows.push(row);
      return row;
    }),
    findUnique: jest.fn(async ({ where }: any) =>
      refreshRows.find((r) => r.jti === where.jti) ?? null,
    ),
    update: jest.fn(async ({ where, data }: any) => {
      const row = refreshRows.find((r) => r.jti === where.jti);
      Object.assign(row, data);
      return row;
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      let count = 0;
      for (const r of refreshRows) {
        if (where.familyId && r.familyId !== where.familyId) continue;
        if (where.userId && r.userId !== where.userId) continue;
        if (where.revokedAt === null && r.revokedAt !== null) continue;
        Object.assign(r, data);
        count++;
      }
      return { count };
    }),
  };
  return {
    __esModule: true,
    default: {
      refreshToken,
      user: {
        findUnique: jest.fn(async ({ where }: any) => userRows.get(where.id) ?? null),
      },
      $transaction: jest.fn(async (ops: any) => {
        if (typeof ops === 'function') {
          return ops({ refreshToken });
        }
        return Promise.all(ops);
      }),
      __rows: { refreshRows, userRows },
    },
  };
});

import prisma from '../prisma';
import { refreshTokens, revokeSession } from '../services/auth.service';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken, REFRESH_TOKEN_TTL_MS } from '../utils/jwt';
import { persistRefreshToken, revokeAllRefreshTokensForUser } from '../services/refresh-token.service';

const rows = (prisma as any).__rows as { refreshRows: any[]; userRows: Map<string, any> };

async function seedSession(userId = 'user-1', role = 'CUSTOMER') {
  const jti = `jti-${rows.refreshRows.length + 1}-${Math.random().toString(36).slice(2)}`;
  const familyId = `fam-${userId}`;
  const token = generateRefreshToken({ userId, role }, jti);
  await persistRefreshToken({
    jti,
    userId,
    familyId,
    token,
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
  });
  return { jti, familyId, token, userId };
}

beforeEach(() => {
  jest.clearAllMocks();
  rows.refreshRows.length = 0;
  rows.userRows.clear();
  rows.userRows.set('user-1', { id: 'user-1', role: 'CUSTOMER', frozenAt: null });
});

describe('refreshTokens (G3)', () => {
  test('rotation issues a new token and stamps the old row with replacedByJti', async () => {
    const { jti, token, familyId } = await seedSession();
    const out = await refreshTokens(token);

    expect(out.accessToken).toBeDefined();
    expect(out.refreshToken).not.toBe(token);
    const newPayload = verifyRefreshToken(out.refreshToken);
    expect(newPayload.jti).not.toBe(jti);

    const oldRow = rows.refreshRows.find((r) => r.jti === jti);
    const newRow = rows.refreshRows.find((r) => r.jti === newPayload.jti);
    expect(oldRow.replacedByJti).toBe(newPayload.jti);
    expect(newRow.familyId).toBe(familyId); // same family across rotations
  });

  test('replaying a rotated token revokes the ENTIRE family (reuse = theft)', async () => {
    const { token } = await seedSession();
    const first = await refreshTokens(token);

    // Attacker replays the original token after the legitimate rotation.
    await expect(refreshTokens(token)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });

    // Every row in the family is revoked — including the legitimate
    // successor the real user still holds.
    expect(rows.refreshRows.every((r) => r.revokedAt !== null)).toBe(true);
    await expect(refreshTokens(first.refreshToken)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  test('a token with no store row (pre-G3 / fabricated jti) is rejected', async () => {
    const token = generateRefreshToken({ userId: 'user-1', role: 'CUSTOMER' }, 'ghost-jti');
    await expect(refreshTokens(token)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  test('an expired store row is rejected', async () => {
    const { token, jti } = await seedSession();
    rows.refreshRows.find((r) => r.jti === jti).expiresAt = new Date(Date.now() - 1000);
    await expect(refreshTokens(token)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  test('a token whose hash does not match the stored row revokes the family', async () => {
    const { jti, token } = await seedSession();
    // Same jti, different token string than the one persisted.
    rows.refreshRows.find((r) => r.jti === jti).hashedToken = 'not-the-real-hash';
    await expect(refreshTokens(token)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(rows.refreshRows.find((r) => r.jti === jti).revokedAt).not.toBeNull();
  });

  test('a frozen user cannot refresh (live check, 403 ACCOUNT_FROZEN)', async () => {
    const { token } = await seedSession();
    rows.userRows.get('user-1').frozenAt = new Date();
    await expect(refreshTokens(token)).rejects.toMatchObject({
      code: 'ACCOUNT_FROZEN',
      statusCode: 403,
    });
  });

  test('an access token is not accepted as a refresh token (wrong secret)', async () => {
    await seedSession();
    const accessToken = generateAccessToken({ userId: 'user-1', role: 'CUSTOMER' });
    await expect(refreshTokens(accessToken)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});

describe('revokeSession (logout, G3)', () => {
  test('revokes the presented token family server-side', async () => {
    const { token, familyId } = await seedSession();
    await revokeSession(token);
    expect(
      rows.refreshRows.filter((r) => r.familyId === familyId).every((r) => r.revokedAt !== null),
    ).toBe(true);
    await expect(refreshTokens(token)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  // MONEY-PIN G2 — revokeSession now RETURNS the user id it revoked for,
  // so the logout route can drop that user's money step-up session too.
  // For a token it cannot read there is no user id to return, so the
  // answer is null: still a no-op, still never throws, and the caller's
  // `if (revokedUserId)` correctly does nothing.
  test('is a no-op for garbage or missing tokens (never throws)', async () => {
    await expect(revokeSession(undefined)).resolves.toBeNull();
    await expect(revokeSession('not-a-jwt')).resolves.toBeNull();
  });

  test('returns the user id for a real token, so logout can close their money session', async () => {
    const seeded = await seedSession();
    await expect(revokeSession(seeded.token)).resolves.toBe(seeded.userId);
  });
});

describe('revokeAllRefreshTokensForUser (freeze, G3)', () => {
  test('kills every live session the user has, across families', async () => {
    const a = await seedSession();
    // Second device/session — different family.
    const jti2 = 'jti-second-device';
    const token2 = generateRefreshToken({ userId: 'user-1', role: 'CUSTOMER' }, jti2);
    await persistRefreshToken({
      jti: jti2,
      userId: 'user-1',
      familyId: 'fam-other',
      token: token2,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    });

    const count = await revokeAllRefreshTokensForUser('user-1');
    expect(count).toBe(2);
    await expect(refreshTokens(a.token)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(refreshTokens(token2)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
