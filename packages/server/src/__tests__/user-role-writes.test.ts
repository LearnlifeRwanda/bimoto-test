// FIELD-FIT G3 — the two writes that could change an account's role.
//
// The team's only siren-flagged report: "when you created an account as
// a driver and after some time the app changes your account to both
// (DRIVER,USER)". These tests pin both halves of the fix:
//
//   createDriverProfile only ever *adds* the ability to drive to an
//   account that lacks it — it never rewrites a role its owner chose;
//
//   updateMe accepts only the three roles the register screen offers,
//   so ADMIN and COOPERATIVE_LEADER cannot be claimed by their holder.
//
// Whether BOTH accounts should exist at all is a separate, open
// question and is deliberately not decided here: BOTH remains something
// a person can choose.

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    user: { findUnique: jest.fn(), update: jest.fn() },
    driverProfile: { create: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock('../utils/crypto', () => ({
  encrypt: (s: string) => `enc(${s})`,
  decrypt: (s: string) => s.replace(/^enc\((.*)\)$/, '$1'),
  hashPhone: (s: string) => `hash(${s})`,
}));

import prisma from '../prisma';
import {
  createDriverProfile,
  updateMe,
  isSelfAssignableRole,
  SELF_ASSIGNABLE_ROLES,
} from '../services/user.service';

const mockPrisma = prisma as any;

function userRow(role: string, extra: Record<string, unknown> = {}) {
  return { id: 'u1', role, phoneEncrypted: 'enc(+250780000001)', emergencyContactsEncrypted: null, ...extra };
}

beforeEach(() => {
  jest.clearAllMocks();
  // $transaction returns one result per operation handed to it.
  mockPrisma.$transaction.mockImplementation(async (ops: unknown[]) =>
    ops.map((_, i) => ({ __op: i })),
  );
  mockPrisma.driverProfile.create.mockReturnValue({ __op: 'profile' });
  mockPrisma.user.update.mockImplementation(async (args: any) => userRow(args.data.role ?? 'CUSTOMER'));
});

describe('createDriverProfile does not rewrite a role its owner chose', () => {
  test.each(['DRIVER', 'BOTH', 'ADMIN', 'COOPERATIVE_LEADER'])(
    'a %s account keeps its role — no user.update is queued',
    async (role) => {
      mockPrisma.user.findUnique.mockResolvedValue(userRow(role, { driverProfile: null }));

      await createDriverProfile('u1', {
        vehicleType: 'MOTO',
        vehicleDescription: 'red moto',
      });

      // The transaction carries the profile insert and nothing else.
      const ops = mockPrisma.$transaction.mock.calls[0][0];
      expect(ops).toHaveLength(1);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    },
  );

  test('a CUSTOMER who adds a driver profile gains driving and keeps riding', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(userRow('CUSTOMER', { driverProfile: null }));

    await createDriverProfile('u1', {
      vehicleType: 'MOTO',
      vehicleDescription: 'red moto',
    });

    const ops = mockPrisma.$transaction.mock.calls[0][0];
    expect(ops).toHaveLength(2);
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { role: 'BOTH' },
    });
  });

  test('the reported flip: registering as DRIVER then creating the profile stays DRIVER', async () => {
    // RegisterPage PUTs the chosen role, then POSTs the driver profile.
    mockPrisma.user.findUnique.mockResolvedValue(userRow('CUSTOMER'));
    await updateMe('u1', { role: 'DRIVER' });
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: 'DRIVER' }) }),
    );

    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(async (ops: unknown[]) => ops.map(() => ({})));
    mockPrisma.user.findUnique.mockResolvedValue(userRow('DRIVER', { driverProfile: null }));

    await createDriverProfile('u1', { vehicleType: 'MOTO', vehicleDescription: 'red moto' });

    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });
});

describe('updateMe accepts only self-assignable roles', () => {
  test.each(SELF_ASSIGNABLE_ROLES)('%s is accepted', async (role) => {
    mockPrisma.user.findUnique.mockResolvedValue(userRow('CUSTOMER'));
    await expect(updateMe('u1', { role })).resolves.toBeDefined();
  });

  test.each(['ADMIN', 'COOPERATIVE_LEADER', 'NONSENSE', '', null, 1])(
    '%p is refused and never reaches the database',
    async (role) => {
      mockPrisma.user.findUnique.mockResolvedValue(userRow('CUSTOMER'));
      await expect(updateMe('u1', { role: role as string })).rejects.toMatchObject({
        statusCode: 400,
        code: 'ROLE_NOT_SELF_ASSIGNABLE',
      });
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    },
  );

  test('an unchanged role is not written at all', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(userRow('DRIVER'));
    await updateMe('u1', { role: 'DRIVER', nickname: 'Jean' });
    const data = mockPrisma.user.update.mock.calls[0][0].data;
    expect(data).toEqual({ nickname: 'Jean' });
  });

  test('other fields still update when no role is sent', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(userRow('DRIVER'));
    await updateMe('u1', { nickname: 'Jean', language: 'rw' });
    const data = mockPrisma.user.update.mock.calls[0][0].data;
    expect(data).toEqual({ nickname: 'Jean', language: 'rw' });
    expect(data.role).toBeUndefined();
  });

  test('isSelfAssignableRole is the single source of the allow-list', () => {
    expect(SELF_ASSIGNABLE_ROLES).toEqual(['CUSTOMER', 'DRIVER', 'BOTH']);
    expect(isSelfAssignableRole('ADMIN')).toBe(false);
    expect(isSelfAssignableRole('COOPERATIVE_LEADER')).toBe(false);
    expect(isSelfAssignableRole('BOTH')).toBe(true);
  });
});
