// R3-DELIVERY-NOTIFICATIONS — unit tests for the recipient-SMS
// pipeline. Mocks ./sms.service so no live gateway is touched.

jest.mock('../sms.service', () => ({
  sendSms: jest.fn().mockResolvedValue({ success: true }),
}));
jest.mock('@sentry/node', () => ({
  captureException: jest.fn(),
}));

import {
  composeDriverEnRouteMessage,
  composeParcelDeliveredMessage,
  composeDriverArrivedAtPickupMessage,
  notifyRecipientDriverEnRoute,
  notifyRecipientParcelDelivered,
  notifyCustomerDriverArrivedAtPickup,
} from '../recipient-sms-notification.service';
import { sendSms } from '../sms.service';

const mockedSendSms = sendSms as jest.MockedFunction<typeof sendSms>;

beforeEach(() => {
  mockedSendSms.mockClear();
  mockedSendSms.mockResolvedValue({ success: true });
});

describe('composeDriverEnRouteMessage', () => {
  it('renders the Kinyarwanda template by default', () => {
    const msg = composeDriverEnRouteMessage('rw', {
      customerName: 'Aljo',
      estimatedMinutes: 12,
    });
    expect(msg).toContain('Bimoto');
    expect(msg).toContain('Aljo');
    expect(msg).toContain('12');
    expect(msg.length).toBeLessThan(160);
  });

  it('renders the English template', () => {
    const msg = composeDriverEnRouteMessage('en', {
      customerName: 'Aljo',
      estimatedMinutes: 12,
    });
    expect(msg).toContain('moto-taxi');
    expect(msg).toContain('Aljo');
    expect(msg.length).toBeLessThan(160);
  });

  it('renders the French template', () => {
    const msg = composeDriverEnRouteMessage('fr', {
      customerName: 'Aljo',
      estimatedMinutes: 12,
    });
    expect(msg).toContain('moto-taxi');
    expect(msg).toContain('Aljo');
    expect(msg.length).toBeLessThan(160);
  });

  it('rounds the ETA up to a minimum of 1', () => {
    const msg = composeDriverEnRouteMessage('en', {
      customerName: 'X',
      estimatedMinutes: 0.3,
    });
    expect(msg).toContain('1 min');
  });
});

describe('composeParcelDeliveredMessage', () => {
  it('renders all 3 languages with sender name + phone', () => {
    for (const lang of ['rw', 'en', 'fr'] as const) {
      const msg = composeParcelDeliveredMessage(lang, {
        customerName: 'Aljo',
        customerPhone: '+250788000000',
      });
      expect(msg).toContain('Aljo');
      expect(msg).toContain('+250788000000');
      expect(msg.length).toBeLessThan(200);
    }
  });
});

describe('notifyRecipientDriverEnRoute', () => {
  it('calls sendSms with the recipient phone and composed message', () => {
    notifyRecipientDriverEnRoute({
      recipientPhone: '+250788000000',
      language: 'rw',
      customerName: 'Aljo',
      estimatedMinutes: 10,
    });
    expect(mockedSendSms).toHaveBeenCalledTimes(1);
    expect(mockedSendSms).toHaveBeenCalledWith(
      '+250788000000',
      expect.stringContaining('Aljo'),
    );
  });

  it('is a no-op when recipientPhone is null', () => {
    notifyRecipientDriverEnRoute({
      recipientPhone: null,
      language: 'rw',
      customerName: 'Aljo',
      estimatedMinutes: 10,
    });
    expect(mockedSendSms).not.toHaveBeenCalled();
  });

  it('is a no-op when recipientPhone is empty/whitespace', () => {
    notifyRecipientDriverEnRoute({
      recipientPhone: '   ',
      language: 'rw',
      customerName: 'Aljo',
      estimatedMinutes: 10,
    });
    expect(mockedSendSms).not.toHaveBeenCalled();
  });

  it('does not throw when sendSms rejects', async () => {
    mockedSendSms.mockRejectedValueOnce(new Error('SMS gateway down'));
    expect(() =>
      notifyRecipientDriverEnRoute({
        recipientPhone: '+250788000000',
        language: 'rw',
        customerName: 'Aljo',
        estimatedMinutes: 10,
      }),
    ).not.toThrow();
    await new Promise((r) => setImmediate(r));
  });
});

describe('notifyRecipientParcelDelivered', () => {
  it('calls sendSms with the recipient phone and composed message', () => {
    notifyRecipientParcelDelivered({
      recipientPhone: '+250788000000',
      language: 'rw',
      customerName: 'Aljo',
      customerPhone: '+250788111111',
    });
    expect(mockedSendSms).toHaveBeenCalledTimes(1);
    expect(mockedSendSms).toHaveBeenCalledWith(
      '+250788000000',
      expect.stringContaining('+250788111111'),
    );
  });

  it('is a no-op when recipientPhone is undefined', () => {
    notifyRecipientParcelDelivered({
      recipientPhone: undefined,
      language: 'rw',
      customerName: 'Aljo',
      customerPhone: '+250788111111',
    });
    expect(mockedSendSms).not.toHaveBeenCalled();
  });
});

// R3-DELIVERY-NOTIFICATIONS-2 — driver-arrived-at-pickup customer SMS.
describe('composeDriverArrivedAtPickupMessage', () => {
  it('renders all 3 languages, fits in a single SMS segment', () => {
    for (const lang of ['rw', 'en', 'fr'] as const) {
      const msg = composeDriverArrivedAtPickupMessage(lang);
      expect(msg).toContain('Bimoto');
      expect(msg.length).toBeLessThan(160);
    }
  });

  it('falls back to Kinyarwanda for unknown language', () => {
    const msg = composeDriverArrivedAtPickupMessage(
      'zz' as unknown as Parameters<typeof composeDriverArrivedAtPickupMessage>[0],
    );
    expect(msg).toContain('moto-taxi yageze');
  });
});

describe('notifyCustomerDriverArrivedAtPickup', () => {
  it('calls sendSms with the customer phone and composed message', () => {
    notifyCustomerDriverArrivedAtPickup({
      customerPhone: '+250788111111',
      language: 'en',
    });
    expect(mockedSendSms).toHaveBeenCalledTimes(1);
    expect(mockedSendSms).toHaveBeenCalledWith(
      '+250788111111',
      expect.stringContaining('pickup point'),
    );
  });

  it('is a no-op when customerPhone is null/empty', () => {
    notifyCustomerDriverArrivedAtPickup({
      customerPhone: null,
      language: 'rw',
    });
    notifyCustomerDriverArrivedAtPickup({
      customerPhone: '   ',
      language: 'rw',
    });
    expect(mockedSendSms).not.toHaveBeenCalled();
  });
});
