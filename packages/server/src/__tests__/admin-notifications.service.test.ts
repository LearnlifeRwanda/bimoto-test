// R3-CONFLICTS-NOTIFICATIONS — admin-notifications service tests.

jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    user: { findMany: jest.fn() },
  },
}));

jest.mock('../services/push', () => ({
  __esModule: true,
  sendPushToUser: jest.fn(),
}));

import prisma from '../prisma';
import { sendPushToUser } from '../services/push';
import {
  composeRecipientDisputePayload,
  notifyAdminsOfNewRecipientDispute,
} from '../services/admin-notifications.service';

const findMany = (prisma as any).user.findMany as jest.Mock;
const mockedSendPushToUser = sendPushToUser as jest.Mock;

const BASE_ARGS = {
  legId: 'leg-1',
  journeyId: 'jrn-1',
  customerNickname: 'Aljo',
  recipientPhone: '+250788111111',
  disputeReason: 'WRONG ITEM',
};

async function flushAsync(): Promise<void> {
  // The notify function fires an async IIFE; flush microtasks so the
  // awaits inside complete before assertions.
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

let consoleErrorSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  mockedSendPushToUser.mockResolvedValue([]);
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
});

describe('composeRecipientDisputePayload', () => {
  test('includes legId in data.deepLink for client-side routing', () => {
    const payload = composeRecipientDisputePayload(BASE_ARGS);
    expect(payload.data?.deepLink).toBe('/admin/conflicts/RECIPIENT_DISPUTE/leg-1');
    expect(payload.data?.legId).toBe('leg-1');
  });

  test('sets data.conflictType to CONFLICT_RECIPIENT_DISPUTE', () => {
    const payload = composeRecipientDisputePayload(BASE_ARGS);
    expect(payload.data?.conflictType).toBe('CONFLICT_RECIPIENT_DISPUTE');
    expect(payload.data?.type).toBe('admin-conflict');
  });

  test('truncates dispute reason longer than 60 chars to 60 + ellipsis', () => {
    const longReason = 'x'.repeat(120);
    const payload = composeRecipientDisputePayload({
      ...BASE_ARGS,
      disputeReason: longReason,
    });
    expect(payload.body).toContain(`${'x'.repeat(60)}...`);
    expect(payload.body).not.toContain('x'.repeat(61));
  });

  test('does not append ellipsis when reason is exactly 60 chars or shorter', () => {
    const reason = 'x'.repeat(60);
    const payload = composeRecipientDisputePayload({ ...BASE_ARGS, disputeReason: reason });
    expect(payload.body).toContain(reason);
    expect(payload.body).not.toContain(`${reason}...`);
  });

  test('includes customer nickname and recipient phone in body', () => {
    const payload = composeRecipientDisputePayload(BASE_ARGS);
    expect(payload.body).toContain('Aljo');
    expect(payload.body).toContain('+250788111111');
  });

  test('falls back to "Customer" when nickname is empty', () => {
    const payload = composeRecipientDisputePayload({ ...BASE_ARGS, customerNickname: '' });
    expect(payload.body).toContain('Customer');
  });
});

describe('notifyAdminsOfNewRecipientDispute — fan-out', () => {
  test('returns synchronously (void) so the caller does not block', () => {
    findMany.mockResolvedValue([]);
    const result = notifyAdminsOfNewRecipientDispute(BASE_ARGS);
    expect(result).toBeUndefined();
  });

  test('queries prisma for users with role === ADMIN only', async () => {
    findMany.mockResolvedValue([]);
    notifyAdminsOfNewRecipientDispute(BASE_ARGS);
    await flushAsync();
    expect(findMany).toHaveBeenCalledWith({
      where: { role: 'ADMIN' },
      select: { id: true },
    });
  });

  test('calls sendPushToUser once per ADMIN user', async () => {
    findMany.mockResolvedValue([{ id: 'admin-1' }, { id: 'admin-2' }, { id: 'admin-3' }]);
    notifyAdminsOfNewRecipientDispute(BASE_ARGS);
    await flushAsync();
    expect(mockedSendPushToUser).toHaveBeenCalledTimes(3);
    const calledIds = mockedSendPushToUser.mock.calls.map((c) => c[0]);
    expect(calledIds.sort()).toEqual(['admin-1', 'admin-2', 'admin-3']);
  });

  test('does NOT call sendPushToUser when no ADMIN users are present', async () => {
    findMany.mockResolvedValue([]);
    notifyAdminsOfNewRecipientDispute(BASE_ARGS);
    await flushAsync();
    expect(mockedSendPushToUser).not.toHaveBeenCalled();
  });

  test('uses Promise.allSettled so one rejecting push does not block the rest', async () => {
    findMany.mockResolvedValue([{ id: 'admin-1' }, { id: 'admin-2' }, { id: 'admin-3' }]);
    mockedSendPushToUser
      .mockRejectedValueOnce(new Error('FCM transient'))
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    notifyAdminsOfNewRecipientDispute(BASE_ARGS);
    await flushAsync();
    // All three were attempted even though the first rejected.
    expect(mockedSendPushToUser).toHaveBeenCalledTimes(3);
  });

  test('does not throw when sendPushToUser rejects', async () => {
    findMany.mockResolvedValue([{ id: 'admin-1' }]);
    mockedSendPushToUser.mockRejectedValue(new Error('boom'));
    expect(() => notifyAdminsOfNewRecipientDispute(BASE_ARGS)).not.toThrow();
    await flushAsync();
  });

  test('does not throw when prisma.user.findMany rejects', async () => {
    findMany.mockRejectedValue(new Error('db down'));
    expect(() => notifyAdminsOfNewRecipientDispute(BASE_ARGS)).not.toThrow();
    await flushAsync();
    expect(mockedSendPushToUser).not.toHaveBeenCalled();
  });

  test('forwards the composed payload to sendPushToUser', async () => {
    findMany.mockResolvedValue([{ id: 'admin-1' }]);
    notifyAdminsOfNewRecipientDispute(BASE_ARGS);
    await flushAsync();
    const [, payload] = mockedSendPushToUser.mock.calls[0];
    expect(payload.title).toBe('New recipient dispute');
    expect(payload.data.legId).toBe('leg-1');
    expect(payload.data.deepLink).toBe('/admin/conflicts/RECIPIENT_DISPUTE/leg-1');
  });
});
