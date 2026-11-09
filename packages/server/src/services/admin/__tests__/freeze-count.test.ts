// PAYOUT-E — unit test for countFrozenDrivers, the extracted single owner
// of the frozen-driver predicate (previously inlined in the admin payout
// summary handler, recorded as a §6 fallback in PAYOUT-D).

jest.mock('../../../prisma', () => ({
  __esModule: true,
  default: { user: { count: jest.fn() } },
}));

import prisma from '../../../prisma';
import { countFrozenDrivers } from '../freeze.service';

const countMock = (prisma as any).user.count as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('countFrozenDrivers', () => {
  test('counts users with frozenAt set and role DRIVER on the default client', async () => {
    countMock.mockResolvedValue(3);
    await expect(countFrozenDrivers()).resolves.toBe(3);
    expect(countMock).toHaveBeenCalledWith({
      where: { frozenAt: { not: null }, role: 'DRIVER' },
    });
  });

  test('uses an injected client when provided', async () => {
    const injected = { user: { count: jest.fn().mockResolvedValue(1) } };
    await expect(countFrozenDrivers(injected as any)).resolves.toBe(1);
    expect(injected.user.count).toHaveBeenCalledWith({
      where: { frozenAt: { not: null }, role: 'DRIVER' },
    });
    expect(countMock).not.toHaveBeenCalled();
  });
});
