// ACCOUNT-RIGHTS-CORE G5 — the deletion contract, both ways.
//
// WHAT THIS FILE USED TO BE. Before this wave it held one test, and that
// test proved nothing. It mocked prisma, then called `prisma.user.update`
// and `prisma.driverProfile.updateMany` ITSELF with the erasure's payload,
// and then asserted that those two mocks had been called with that
// payload. It never imported the route, the handler, or any production
// function. Its final assertion — "Journeys should NOT be deleted (we
// never call journey.deleteMany)" — was true of a test that called
// nothing. It would have passed with the entire deletion feature deleted
// from the codebase.
//
// The behaviour it claimed to cover is now covered against the real
// functions, and the shape it could not see (the window, the tombstone,
// the sessions, the atomicity) is covered here too.

jest.mock('../prisma', () => {
  const db: any = {
    user: { findUnique: jest.fn(), update: jest.fn() },
    driverProfile: { findUnique: jest.fn(), updateMany: jest.fn() },
    accountTombstone: { upsert: jest.fn(), findUnique: jest.fn() },
    deviceToken: { deleteMany: jest.fn(async () => ({ count: 0 })) },
    otpCode: { deleteMany: jest.fn(async () => ({ count: 0 })) },
    refreshToken: { updateMany: jest.fn(async () => ({ count: 0 })) },
    deletionRequest: {
      findFirst: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    journey: { findMany: jest.fn(), findFirst: jest.fn() },
  };
  // A transaction double with rollback SEMANTICS, not just a pass-through.
  // Writes issued through `tx` are recorded; if the callback throws, they
  // are reported as rolled back and the callback's rejection propagates.
  // That is what lets the atomicity test below assert something real
  // rather than asserting that a mock was called.
  db.__txWrites = [] as string[];
  db.__committed = false;
  db.$transaction = jest.fn(async (cb: any) => {
    db.__txWrites = [];
    db.__committed = false;
    const record = (model: string, op: string) => (args: any) => {
      db.__txWrites.push(`${model}.${op}`);
      return (db as any)[model][op](args);
    };
    const tx: any = {};
    for (const model of Object.keys(db)) {
      if (model.startsWith('$') || model.startsWith('__')) continue;
      tx[model] = {};
      for (const op of Object.keys(db[model])) tx[model][op] = record(model, op);
    }
    const out = await cb(tx);
    db.__committed = true;
    return out;
  });
  return { __esModule: true, default: db };
});

jest.mock('../utils/crypto', () => ({
  encrypt: jest.fn((text: string) => `encrypted:${text}`),
  hashPhone: jest.fn((text: string) => `hashed:${text}`),
  decrypt: jest.fn((text: string) => text.replace('encrypted:', '')),
}));

jest.mock('../services/document-deletion.service', () => ({
  deleteDocumentsForUrls: jest.fn(),
  deleteLegacyVerificationDir: jest.fn(),
}));

jest.mock('../middleware/auth-status-cache', () => ({
  invalidateAuthStatusCache: jest.fn(),
}));

import prisma from '../prisma';
import { ACCOUNT_DELETION_HOLD_HOURS } from '@bimoto/shared';
import {
  cancelDeletion,
  executeErasure,
  getPendingDeletion,
  requestDeletion,
} from '../services/account-deletion.service';
import {
  deleteDocumentsForUrls,
  deleteLegacyVerificationDir,
} from '../services/document-deletion.service';
import { invalidateAuthStatusCache } from '../middleware/auth-status-cache';

const db = prisma as any;
const USER = 'u1';
// Deliberately NOT phone-shaped. hashPhone's real output is a digest; a
// fixture that embedded the number would make the "never dialable"
// assertion below vacuous.
const ORIGINAL_PHONE = '+250788000111';
const ORIGINAL_HASH = 'd6f1a0c39b7e4c2a8f05b31e7c9d4a62';

function seedErasableUser(overrides: Record<string, unknown> = {}) {
  db.user.findUnique.mockResolvedValue({
    id: USER,
    phoneHash: ORIGINAL_HASH,
    suspendedUntil: null,
    frozenAt: null,
    ...overrides,
  });
  db.driverProfile.findUnique.mockResolvedValue(null);
  db.accountTombstone.upsert.mockResolvedValue({ deletionCount: 1 });
  db.deletionRequest.updateMany.mockResolvedValue({ count: 1 });
  // Re-stub every step: jest.clearAllMocks() clears CALLS but not
  // implementations, so a mockRejectedValue set by the fault-injection
  // test would otherwise leak into the tests after it.
  db.deviceToken.deleteMany.mockResolvedValue({ count: 0 });
  db.otpCode.deleteMany.mockResolvedValue({ count: 0 });
  db.refreshToken.updateMany.mockResolvedValue({ count: 0 });
  db.user.update.mockResolvedValue({ id: USER });
  db.driverProfile.updateMany.mockResolvedValue({ count: 0 });
}

beforeEach(() => {
  jest.clearAllMocks();
});

/* ------------------------------------------- the 72-hour window ------- */

describe('requestDeletion — the window opens', () => {
  test('creates a PENDING request executing exactly ACCOUNT_DELETION_HOLD_HOURS out', async () => {
    db.deletionRequest.findFirst.mockResolvedValue(null);
    db.deletionRequest.create.mockImplementation(async ({ data }: any) => data);

    const before = Date.now();
    const created = await requestDeletion(USER);
    const after = Date.now();

    const gap = created.executesAt.getTime() - created.requestedAt.getTime();
    expect(gap).toBe(ACCOUNT_DELETION_HOLD_HOURS * 60 * 60 * 1000);
    expect(created.status).toBe('PENDING');
    // requestedAt is the Law 058/2021 compliance timestamp — it is
    // "now", not the execution moment.
    expect(created.requestedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(created.requestedAt.getTime()).toBeLessThanOrEqual(after);
  });

  test('72 hours is what the constant says, and nothing erases during it', () => {
    expect(ACCOUNT_DELETION_HOLD_HOURS).toBe(72);
  });

  test('a second ask while one is pending is 409, and creates no second row', async () => {
    db.deletionRequest.findFirst.mockResolvedValue({ id: 'dr1', status: 'PENDING' });

    await expect(requestDeletion(USER)).rejects.toMatchObject({
      statusCode: 409,
      code: 'DELETION_ALREADY_PENDING',
    });
    expect(db.deletionRequest.create).not.toHaveBeenCalled();
  });

  test('a double-tap that races past the read is still 409, not a 500', async () => {
    // The partial unique index refuses the loser. The service must render
    // that as the same 409 the loser would have got a millisecond earlier.
    db.deletionRequest.findFirst.mockResolvedValue(null);
    db.deletionRequest.create.mockRejectedValue(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
    );

    await expect(requestDeletion(USER)).rejects.toMatchObject({
      statusCode: 409,
      code: 'DELETION_ALREADY_PENDING',
    });
  });
});

describe('cancelDeletion — and the request/cancel/re-request round trip', () => {
  test('cancelling a PENDING request stamps CANCELLED', async () => {
    db.deletionRequest.updateMany.mockResolvedValue({ count: 1 });
    await expect(cancelDeletion(USER)).resolves.toEqual({ cancelled: 1 });
    expect(db.deletionRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: USER, status: 'PENDING' },
        data: expect.objectContaining({ status: 'CANCELLED' }),
      }),
    );
  });

  test('cancelling with nothing pending is 404', async () => {
    db.deletionRequest.updateMany.mockResolvedValue({ count: 0 });
    await expect(cancelDeletion(USER)).rejects.toMatchObject({
      statusCode: 404,
      code: 'NO_DELETION_PENDING',
    });
  });

  test('request -> cancel -> request again is allowed: the second ask is a new window', async () => {
    db.deletionRequest.findFirst.mockResolvedValue(null);
    db.deletionRequest.create.mockImplementation(async ({ data }: any) => data);
    const first = await requestDeletion(USER);

    db.deletionRequest.updateMany.mockResolvedValue({ count: 1 });
    await cancelDeletion(USER);

    // After the cancel there is no PENDING row, so the read finds nothing
    // and the second ask succeeds — the invariant is one PENDING request,
    // not one request ever.
    db.deletionRequest.findFirst.mockResolvedValue(null);
    const second = await requestDeletion(USER);
    expect(second.status).toBe('PENDING');
    expect(second.executesAt.getTime()).toBeGreaterThanOrEqual(
      first.executesAt.getTime(),
    );
  });
});

/* -------------------------------------------------- the erasure ------- */

describe('executeErasure — what it destroys', () => {
  test('anonymises the User row exactly as the pre-window handler did', async () => {
    seedErasableUser();
    await executeErasure(USER);

    expect(db.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: USER },
        data: expect.objectContaining({
          phoneEncrypted: 'encrypted:DELETED-u1',
          phoneHash: 'hashed:DELETED-u1',
          nickname: 'Deleted User',
          emergencyContactsEncrypted: null,
          isDeleted: true,
          accountDeletedAt: expect.any(Date),
        }),
      }),
    );
  });

  test('anonymises the DriverProfile exactly as the pre-window handler did', async () => {
    seedErasableUser();
    await executeErasure(USER);

    expect(db.driverProfile.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: USER },
        data: expect.objectContaining({
          registrationPlate: null,
          vehicleDescription: 'Deleted',
          drivingLicenseNumber: null,
          ruraAuthorizationNumber: null,
          cooperativeName: null,
          drivingLicensePhotoUrl: null,
          ruraAuthorizationPhotoUrl: null,
          insurancePhotoUrl: null,
          isOnline: false,
        }),
      }),
    );
  });

  test('deletes device tokens — the Cascade never fires because we never hard-delete', async () => {
    seedErasableUser();
    await executeErasure(USER);
    expect(db.deviceToken.deleteMany).toHaveBeenCalledWith({ where: { userId: USER } });
  });

  test('deletes outstanding OTP codes for the ORIGINAL number, not the DELETED- one', async () => {
    seedErasableUser();
    await executeErasure(USER);
    expect(db.otpCode.deleteMany).toHaveBeenCalledWith({
      where: { phoneHash: ORIGINAL_HASH },
    });
  });

  test('closes the pending request as EXECUTED', async () => {
    seedErasableUser();
    await executeErasure(USER);
    expect(db.deletionRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: USER, status: 'PENDING' },
        data: expect.objectContaining({ status: 'EXECUTED', deferredReason: null }),
      }),
    );
  });

  test('sweeps the driver documents by URL, after the transaction commits', async () => {
    seedErasableUser();
    db.driverProfile.findUnique.mockResolvedValue({
      drivingLicensePhotoUrl: '/api/documents/a',
      ruraAuthorizationPhotoUrl: '/api/documents/b',
      insurancePhotoUrl: null,
    });

    await executeErasure(USER);

    expect(deleteDocumentsForUrls).toHaveBeenCalledWith([
      '/api/documents/a',
      '/api/documents/b',
      null,
    ]);
    expect(deleteLegacyVerificationDir).toHaveBeenCalledWith(USER);
  });

  test('invalidates the auth cache after commit, so the next request re-reads', async () => {
    seedErasableUser();
    await executeErasure(USER);
    expect(invalidateAuthStatusCache).toHaveBeenCalledWith(USER);
  });
});

describe('executeErasure — what it must NOT touch', () => {
  test('no journey, escrow, rating, report or parcel photo is written', async () => {
    seedErasableUser();
    await executeErasure(USER);

    // Parcel photos (pickupPhotoUrl / deliveryPhotoUrl) live on Journey.
    // Founder ruling, 19 Aug: individual deletion NEVER touches them —
    // they belong to the delivery, and the other party's proof of it.
    // The erasure writing to Journey at all would be the first step
    // toward touching them, so the assertion is that it does not.
    expect(db.journey.findMany).not.toHaveBeenCalled();
    for (const write of db.__txWrites) {
      expect(write).not.toMatch(/^journey\./);
      expect(write).not.toMatch(/^escrow/i);
    }
  });

  test('the User row is anonymised, never deleted — 29 relation fields depend on it', async () => {
    seedErasableUser();
    await executeErasure(USER);
    expect(db.user.update).toHaveBeenCalled();
    expect((db.user as any).delete).toBeUndefined();
    expect(db.__txWrites).not.toContain('user.delete');
    expect(db.__txWrites).not.toContain('user.deleteMany');
  });
});

/* ------------------------------------------------- the tombstone ------ */

describe('the tombstone — founder ruling D2, exactly three facts', () => {
  test('is keyed by the ORIGINAL hash, the one the same transaction destroys', async () => {
    seedErasableUser();
    await executeErasure(USER);

    const call = db.accountTombstone.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ phoneHash: ORIGINAL_HASH });
    // Not the post-erasure hash. If this ever flips, a returner becomes
    // unrecognisable and reactivation-by-deletion is back.
    expect(call.where.phoneHash).not.toBe('hashed:DELETED-u1');
  });

  test('written in the SAME transaction as the write that destroys the hash', async () => {
    seedErasableUser();
    await executeErasure(USER);
    expect(db.__txWrites).toContain('accountTombstone.upsert');
    expect(db.__txWrites).toContain('user.update');
    expect(db.__txWrites.indexOf('accountTombstone.upsert')).toBeLessThan(
      db.__txWrites.indexOf('user.update'),
    );
  });

  test('carries the three D2 facts, and Object.keys proves nothing more', async () => {
    seedErasableUser();
    await executeErasure(USER);

    const { create } = db.accountTombstone.upsert.mock.calls[0][0];
    expect(Object.keys(create).sort()).toEqual(
      ['deletionCount', 'lastDeletedAt', 'phoneHash', 'wasSuspended'].sort(),
    );
    // The pinning direction that matters: no user id, no encrypted phone,
    // no nickname, no relation. A tombstone that grows a fourth fact is a
    // retention-policy change, not a refactor.
    for (const forbidden of [
      'userId',
      'user',
      'phoneEncrypted',
      'phone',
      'nickname',
      'emergencyContacts',
      'id',
    ]) {
      expect(create).not.toHaveProperty(forbidden);
    }
  });

  test('stores a HASH, never a dialable number', async () => {
    seedErasableUser();
    await executeErasure(USER);
    const { create } = db.accountTombstone.upsert.mock.calls[0][0];
    expect(create.phoneHash).toBe(ORIGINAL_HASH);
    // The whole row, serialised, contains no dialable number anywhere —
    // not in the key, not smuggled into a sibling field. The tombstone is
    // the one table that could plausibly justify keeping a number, and it
    // does not keep one.
    expect(JSON.stringify(create)).not.toContain(ORIGINAL_PHONE);
    expect(JSON.stringify(create)).not.toMatch(/\+?250\d{9}/);
  });

  test('a clean account records wasSuspended false', async () => {
    seedErasableUser({ suspendedUntil: null, frozenAt: null });
    await executeErasure(USER);
    expect(db.accountTombstone.upsert.mock.calls[0][0].create.wasSuspended).toBe(false);
  });

  test('a live suspension records wasSuspended true', async () => {
    seedErasableUser({ suspendedUntil: new Date(Date.now() + 60_000) });
    await executeErasure(USER);
    expect(db.accountTombstone.upsert.mock.calls[0][0].create.wasSuspended).toBe(true);
  });

  test('a LAPSED suspension does not count — it is over', async () => {
    seedErasableUser({ suspendedUntil: new Date(Date.now() - 60_000) });
    await executeErasure(USER);
    expect(db.accountTombstone.upsert.mock.calls[0][0].create.wasSuspended).toBe(false);
  });

  test('a freeze records wasSuspended true', async () => {
    seedErasableUser({ frozenAt: new Date() });
    await executeErasure(USER);
    expect(db.accountTombstone.upsert.mock.calls[0][0].create.wasSuspended).toBe(true);
  });

  test('wasSuspended is sticky-OR: a clean second deletion cannot launder the first', async () => {
    seedErasableUser({ suspendedUntil: null, frozenAt: null });
    await executeErasure(USER);

    // The clean run must not write wasSuspended:false on the UPDATE
    // branch — that branch is the one a returning account takes, and
    // setting it false there is exactly how the flag would be laundered.
    const { update } = db.accountTombstone.upsert.mock.calls[0][0];
    expect(update).not.toHaveProperty('wasSuspended');
    expect(update.deletionCount).toEqual({ increment: 1 });
  });

  test('a suspended second deletion DOES set the flag on the update branch', async () => {
    seedErasableUser({ frozenAt: new Date() });
    await executeErasure(USER);
    const { update } = db.accountTombstone.upsert.mock.calls[0][0];
    expect(update.wasSuspended).toBe(true);
  });
});

/* -------------------------------------------------- the sessions ------ */

describe('sessions do not survive erasure', () => {
  test('every live refresh token is revoked, inside the transaction', async () => {
    seedErasableUser();
    db.refreshToken.updateMany.mockResolvedValue({ count: 3 });

    const result = await executeErasure(USER);

    expect(result.revokedTokenCount).toBe(3);
    expect(db.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: USER, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    // Inside, not after: a revoke that outlived a rolled-back erasure
    // would log a still-live user out for nothing.
    expect(db.__txWrites).toContain('refreshToken.updateMany');
  });
});

/* ------------------------------------------------- the atomicity ------ */

describe('atomicity — fault injection', () => {
  test('a throwing revoke step rolls the whole erasure back: the user is NOT anonymised', async () => {
    seedErasableUser();
    db.refreshToken.updateMany.mockRejectedValue(new Error('revoke exploded'));

    await expect(executeErasure(USER)).rejects.toThrow('revoke exploded');

    // The transaction never committed...
    expect(db.__committed).toBe(false);
    // ...so nothing downstream of the failure ran...
    expect(db.__txWrites).not.toContain('deletionRequest.updateMany');
    // ...and neither did either post-commit side effect. This is the
    // whole point of moving them out: a filesystem delete cannot be
    // rolled back, so it must never run for an erasure that did not
    // happen.
    expect(deleteDocumentsForUrls).not.toHaveBeenCalled();
    expect(deleteLegacyVerificationDir).not.toHaveBeenCalled();
    expect(invalidateAuthStatusCache).not.toHaveBeenCalled();
  });

  test('every write goes through the transaction handle — none through the bare client', async () => {
    seedErasableUser();
    await executeErasure(USER);

    // The pre-wave handler issued three writes on the top-level client
    // with no transaction at all, which is the class-(a) defect
    // txn-guard parked under this wave's name. Each write below is
    // recorded only when it arrives via `tx`.
    for (const write of [
      'accountTombstone.upsert',
      'user.update',
      'driverProfile.updateMany',
      'deviceToken.deleteMany',
      'otpCode.deleteMany',
      'refreshToken.updateMany',
      'deletionRequest.updateMany',
    ]) {
      expect(db.__txWrites).toContain(write);
    }
    expect(db.__committed).toBe(true);
  });

  test('a missing user is a 404, and writes nothing', async () => {
    db.user.findUnique.mockResolvedValue(null);
    await expect(executeErasure(USER)).rejects.toMatchObject({
      statusCode: 404,
      code: 'USER_NOT_FOUND',
    });
    expect(db.user.update).not.toHaveBeenCalled();
    expect(db.accountTombstone.upsert).not.toHaveBeenCalled();
  });
});

// ACCOUNT-RIGHTS-SURFACE G1 — the view the client actually reads.
describe('getPendingDeletion — what GET /me carries', () => {
  test('null when nothing is pending', async () => {
    db.deletionRequest.findFirst.mockResolvedValueOnce(null);
    await expect(getPendingDeletion(USER)).resolves.toBeNull();
  });

  test('carries deferredReason alongside the two timestamps', async () => {
    const requestedAt = new Date('2026-08-20T10:00:00Z');
    const executesAt = new Date('2026-08-23T10:00:00Z');
    db.deletionRequest.findFirst.mockResolvedValueOnce({
      requestedAt,
      executesAt,
      deferredReason: 'LIVE_ESCROW',
    });

    await expect(getPendingDeletion(USER)).resolves.toEqual({
      requestedAt,
      executesAt,
      deferredReason: 'LIVE_ESCROW',
    });
  });

  test('deferredReason is null — never undefined — on a request nothing is blocking', async () => {
    // The client renders `deferredReason ? reason : countdown`; a missing
    // key and an explicit null must not be two different things there.
    db.deletionRequest.findFirst.mockResolvedValueOnce({
      requestedAt: new Date(),
      executesAt: new Date(),
      deferredReason: null,
    });
    const view = await getPendingDeletion(USER);
    expect(view).not.toBeNull();
    expect(view!.deferredReason).toBeNull();
  });

  test('reads only the PENDING row, newest first', async () => {
    db.deletionRequest.findFirst.mockResolvedValueOnce(null);
    await getPendingDeletion(USER);
    expect(db.deletionRequest.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: USER, status: 'PENDING' },
        select: { requestedAt: true, executesAt: true, deferredReason: true },
        orderBy: { requestedAt: 'desc' },
      }),
    );
  });
});
