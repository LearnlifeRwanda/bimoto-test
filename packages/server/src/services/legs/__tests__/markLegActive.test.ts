// R3-DELIVERY-NOTIFICATIONS-2 — markLegActive flips PENDING → ACTIVE
// and fires a customer-arrived SMS when the leg type is GOODS_PICKUP.
// First user of the LegStatus.ACTIVE state (R3-LEGS introduced the
// enum value but no code path used it until now).

jest.mock('../../../prisma', () => {
  const updateManyMock = jest.fn();
  const findUniqueLegMock = jest.fn();
  const findUniqueJourneyMock = jest.fn();
  return {
    __esModule: true,
    default: {
      leg: {
        updateMany: updateManyMock,
        findUnique: findUniqueLegMock,
      },
      journey: {
        findUnique: findUniqueJourneyMock,
      },
    },
  };
});

jest.mock('../../sms.service', () => ({
  sendSms: jest.fn().mockResolvedValue({ success: true }),
}));

jest.mock('@sentry/node', () => ({
  captureException: jest.fn(),
}));

import prisma from '../../../prisma';
import { encrypt } from '../../../utils/crypto';
import { markLegActive } from '../legs.service';
import { sendSms } from '../../sms.service';

const mockedSendSms = sendSms as jest.MockedFunction<typeof sendSms>;

beforeEach(() => {
  jest.clearAllMocks();
  mockedSendSms.mockResolvedValue({ success: true });
  (prisma.leg.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
});

describe('markLegActive', () => {
  it('flips status to ACTIVE via composite (legId, journeyId) where', async () => {
    (prisma.leg.findUnique as jest.Mock).mockResolvedValue({
      id: 'leg-1',
      type: 'PASSENGER_PICKUP',
    });

    await markLegActive('leg-1', 'j1');

    expect(prisma.leg.updateMany).toHaveBeenCalledWith({
      where: { id: 'leg-1', journeyId: 'j1' },
      data: { status: 'ACTIVE' },
    });
  });

  it('fires notifyCustomerDriverArrivedAtPickup on GOODS_PICKUP', async () => {
    (prisma.leg.findUnique as jest.Mock).mockResolvedValue({
      id: 'leg-1',
      type: 'GOODS_PICKUP',
    });
    (prisma.journey.findUnique as jest.Mock).mockResolvedValue({
      id: 'j1',
      customer: {
        phoneEncrypted: encrypt('+250788111111'),
        language: 'rw',
      },
    });

    await markLegActive('leg-1', 'j1');

    expect(mockedSendSms).toHaveBeenCalledTimes(1);
    expect(mockedSendSms.mock.calls[0][0]).toBe('+250788111111');
    // Kinyarwanda body: "Bimoto: moto-taxi yageze aho izajya ifata ipake yawe."
    expect(mockedSendSms.mock.calls[0][1]).toContain('moto-taxi yageze');
  });

  it('does NOT fire driver-arrived SMS on PASSENGER_PICKUP (defensive)', async () => {
    (prisma.leg.findUnique as jest.Mock).mockResolvedValue({
      id: 'leg-1',
      type: 'PASSENGER_PICKUP',
    });

    await markLegActive('leg-1', 'j1');

    expect(mockedSendSms).not.toHaveBeenCalled();
  });

  it('does NOT fire driver-arrived SMS on GOODS_DROPOFF', async () => {
    (prisma.leg.findUnique as jest.Mock).mockResolvedValue({
      id: 'leg-1',
      type: 'GOODS_DROPOFF',
    });

    await markLegActive('leg-1', 'j1');

    expect(mockedSendSms).not.toHaveBeenCalled();
  });

  it('throws when no row matches the composite where (cross-journey safety)', async () => {
    (prisma.leg.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

    await expect(markLegActive('leg-bogus', 'j1')).rejects.toThrow(
      'Leg not found for journey',
    );
    expect(mockedSendSms).not.toHaveBeenCalled();
  });

  it('uses the customer.language for the SMS body (French case)', async () => {
    (prisma.leg.findUnique as jest.Mock).mockResolvedValue({
      id: 'leg-1',
      type: 'GOODS_PICKUP',
    });
    (prisma.journey.findUnique as jest.Mock).mockResolvedValue({
      id: 'j1',
      customer: {
        phoneEncrypted: encrypt('+250788111111'),
        language: 'fr',
      },
    });

    await markLegActive('leg-1', 'j1');

    // French body: "Bimoto: le moto-taxi est arrive au point de collecte…"
    expect(mockedSendSms.mock.calls[0][1]).toContain('point de collecte');
  });
});
