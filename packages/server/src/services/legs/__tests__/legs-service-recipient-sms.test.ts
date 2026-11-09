// R3-DELIVERY-NOTIFICATIONS — integration test that markLegCompleted
// fires the parcel-delivered SMS to the recipient when a GOODS_DROPOFF
// leg with contactPhone completes. Only the dropoff fires; pickup
// completion is a no-op.

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
import { markLegCompleted } from '../legs.service';
import { sendSms } from '../../sms.service';

const mockedSendSms = sendSms as jest.MockedFunction<typeof sendSms>;

beforeEach(() => {
  jest.clearAllMocks();
  mockedSendSms.mockResolvedValue({ success: true });
  (prisma.leg.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
});

describe('markLegCompleted → recipient delivered SMS', () => {
  it('fires sendSms once with recipient phone and customer phone in body for GOODS_DROPOFF', async () => {
    (prisma.leg.findUnique as jest.Mock).mockResolvedValue({
      id: 'leg-1',
      type: 'GOODS_DROPOFF',
      contactPhone: '+250788000000',
    });
    (prisma.journey.findUnique as jest.Mock).mockResolvedValue({
      id: 'j1',
      customer: {
        nickname: 'Aljo',
        phoneEncrypted: encrypt('+250788111111'),
        language: 'rw',
      },
    });

    await markLegCompleted('leg-1', 'j1');

    expect(mockedSendSms).toHaveBeenCalledTimes(1);
    expect(mockedSendSms.mock.calls[0][0]).toBe('+250788000000');
    expect(mockedSendSms.mock.calls[0][1]).toContain('+250788111111');
  });

  it('does not fire sendSms for GOODS_PICKUP completion', async () => {
    (prisma.leg.findUnique as jest.Mock).mockResolvedValue({
      id: 'leg-1',
      type: 'GOODS_PICKUP',
      contactPhone: '+250788000000',
    });

    await markLegCompleted('leg-1', 'j1');

    expect(mockedSendSms).not.toHaveBeenCalled();
  });

  it('does not fire sendSms when contactPhone is missing', async () => {
    (prisma.leg.findUnique as jest.Mock).mockResolvedValue({
      id: 'leg-1',
      type: 'GOODS_DROPOFF',
      contactPhone: null,
    });

    await markLegCompleted('leg-1', 'j1');

    expect(mockedSendSms).not.toHaveBeenCalled();
  });

  it('does not fire sendSms for PASSENGER_DROPOFF', async () => {
    (prisma.leg.findUnique as jest.Mock).mockResolvedValue({
      id: 'leg-1',
      type: 'PASSENGER_DROPOFF',
      contactPhone: '+250788000000',
    });

    await markLegCompleted('leg-1', 'j1');

    expect(mockedSendSms).not.toHaveBeenCalled();
  });

  it('skips SMS silently when journey customer is missing', async () => {
    (prisma.leg.findUnique as jest.Mock).mockResolvedValue({
      id: 'leg-1',
      type: 'GOODS_DROPOFF',
      contactPhone: '+250788000000',
    });
    (prisma.journey.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(markLegCompleted('leg-1', 'j1')).resolves.not.toThrow();
    expect(mockedSendSms).not.toHaveBeenCalled();
  });

  // R3-DELIVERY-NOTIFICATIONS-2 — per-leg recipientLanguage hint wins
  // over the customer's User.language at SMS-compose time.
  it('uses leg.recipientLanguage when set (overrides customer.language)', async () => {
    (prisma.leg.findUnique as jest.Mock).mockResolvedValue({
      id: 'leg-1',
      type: 'GOODS_DROPOFF',
      contactPhone: '+250788000000',
      recipientLanguage: 'fr',
    });
    (prisma.journey.findUnique as jest.Mock).mockResolvedValue({
      id: 'j1',
      customer: {
        nickname: 'Aljo',
        phoneEncrypted: encrypt('+250788111111'),
        language: 'rw', // customer is Kinyarwanda; recipient overrides to French
      },
    });

    await markLegCompleted('leg-1', 'j1');

    expect(mockedSendSms).toHaveBeenCalledTimes(1);
    // French body: "Bimoto: votre colis de Aljo a ete livre…"
    expect(mockedSendSms.mock.calls[0][1]).toContain('votre colis de Aljo');
  });

  it('falls back to customer.language when leg.recipientLanguage is null', async () => {
    (prisma.leg.findUnique as jest.Mock).mockResolvedValue({
      id: 'leg-1',
      type: 'GOODS_DROPOFF',
      contactPhone: '+250788000000',
      recipientLanguage: null,
    });
    (prisma.journey.findUnique as jest.Mock).mockResolvedValue({
      id: 'j1',
      customer: {
        nickname: 'Aljo',
        phoneEncrypted: encrypt('+250788111111'),
        language: 'en',
      },
    });

    await markLegCompleted('leg-1', 'j1');

    expect(mockedSendSms).toHaveBeenCalledTimes(1);
    // English body: "Bimoto: your parcel from Aljo has been delivered…"
    expect(mockedSendSms.mock.calls[0][1]).toContain('your parcel from Aljo');
  });
});
