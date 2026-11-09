// G6(a) — the named helper is the one this file ASSERTS on and stays a
// jest.fn() of its own; everything else in the module is auto-stubbed, so
// a notify* added to a path this file exercises cannot fail it for a
// reason that has nothing to do with ring expansion.
jest.mock('../../notification.service', () =>
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('../../../__tests__/helpers/notification-service-mock').autoStubbedModule({
    notifyDriverOfNewlyAvailableJourney: jest.fn(),
  }),
);

import {
  broadcastToRingDrivers,
  _resetNotifiedRegistryForTests,
} from '../supply-broadcast';
import { _resetTierConfigForTests } from '../../mobility/tier-classification';
import * as notificationService from '../../notification.service';
import { notifyDriversOfRingExpansion } from '../notify-on-expansion';

const KIGALI = { lat: -1.9536, lng: 30.0606 };

const notifyMock =
  notificationService.notifyDriverOfNewlyAvailableJourney as jest.Mock;

beforeEach(() => {
  _resetNotifiedRegistryForTests();
  _resetTierConfigForTests();
  notifyMock.mockClear();
});

describe('discovery/notify-on-expansion — direct fan-out', () => {
  it('calls notification.service once per driver id', () => {
    notifyDriversOfRingExpansion('jX', ['d1', 'd2', 'd3']);
    expect(notifyMock).toHaveBeenCalledTimes(3);
    expect(notifyMock).toHaveBeenCalledWith('d1', 'jX');
    expect(notifyMock).toHaveBeenCalledWith('d2', 'jX');
    expect(notifyMock).toHaveBeenCalledWith('d3', 'jX');
  });

  it('empty list → no notifications fired', () => {
    notifyDriversOfRingExpansion('jY', []);
    expect(notifyMock).not.toHaveBeenCalled();
  });
});

describe('discovery/notify-on-expansion — integrated with broadcastToRingDrivers (no double-notify)', () => {
  function makePrismaWithDrivers(
    rows: Array<{ userId: string; lastLat: number; lastLng: number }>,
  ) {
    return {
      driverProfile: {
        findMany: jest.fn().mockResolvedValue(rows),
      },
    } as any;
  }

  // 5 drivers — 2 within 200m, 3 more within 500m (but >200m)
  const driversInRingExpansion = [
    // 2 in 200m
    { userId: 'near1', lastLat: KIGALI.lat + 0.0008, lastLng: KIGALI.lng },
    { userId: 'near2', lastLat: KIGALI.lat - 0.0008, lastLng: KIGALI.lng },
    // 3 between 200m and 500m (~330-440m)
    { userId: 'mid1', lastLat: KIGALI.lat + 0.003, lastLng: KIGALI.lng },
    { userId: 'mid2', lastLat: KIGALI.lat - 0.003, lastLng: KIGALI.lng },
    { userId: 'mid3', lastLat: KIGALI.lat, lastLng: KIGALI.lng + 0.003 },
  ];

  it('ring 0 (200m) notifies the 2 nearest; ring 1 (500m) notifies the 3 newly included; nobody twice', async () => {
    const prisma = makePrismaWithDrivers(driversInRingExpansion);
    // Ring 0 — 200m
    const ring0 = await broadcastToRingDrivers({
      prisma,
      io: null,
      journeyId: 'jExpand',
      pickup: KIGALI,
      ringRadiusMeters: 200,
    });
    expect(ring0.sort()).toEqual(['near1', 'near2']);
    expect(notifyMock).toHaveBeenCalledTimes(2);
    expect(notifyMock).toHaveBeenCalledWith('near1', 'jExpand');
    expect(notifyMock).toHaveBeenCalledWith('near2', 'jExpand');

    notifyMock.mockClear();

    // Ring 1 — 500m: prisma findMany returns the same 5; the new drivers are
    // mid1/mid2/mid3 since near1/near2 are already in the registry.
    const ring1 = await broadcastToRingDrivers({
      prisma,
      io: null,
      journeyId: 'jExpand',
      pickup: KIGALI,
      ringRadiusMeters: 500,
    });
    expect(ring1.sort()).toEqual(['mid1', 'mid2', 'mid3']);
    expect(notifyMock).toHaveBeenCalledTimes(3);
    expect(notifyMock).toHaveBeenCalledWith('mid1', 'jExpand');
    expect(notifyMock).toHaveBeenCalledWith('mid2', 'jExpand');
    expect(notifyMock).toHaveBeenCalledWith('mid3', 'jExpand');

    // Ring 2 — 1km: same 5 still match; nobody new → zero notifications.
    notifyMock.mockClear();
    const ring2 = await broadcastToRingDrivers({
      prisma,
      io: null,
      journeyId: 'jExpand',
      pickup: KIGALI,
      ringRadiusMeters: 1000,
    });
    expect(ring2).toEqual([]);
    expect(notifyMock).not.toHaveBeenCalled();
  });
});
