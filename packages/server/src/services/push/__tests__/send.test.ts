jest.mock('../../../prisma', () => ({
  __esModule: true,
  default: {
    deviceToken: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock('../fcm-client', () => ({
  __esModule: true,
  sendFcm: jest.fn(),
  resetFcmClientForTests: jest.fn(),
}));

jest.mock('../apns-client', () => ({
  __esModule: true,
  sendApns: jest.fn(),
  resetApnsClientForTests: jest.fn(),
}));

import prisma from '../../../prisma';
import { sendFcm } from '../fcm-client';
import { sendApns } from '../apns-client';
import { sendPushToUser } from '../send';
import { PushError } from '../errors';
import type { PushPayload } from '../types';

const findMany = (prisma as any).deviceToken.findMany as jest.Mock;
const update = (prisma as any).deviceToken.update as jest.Mock;
const fcm = sendFcm as jest.Mock;
const apns = sendApns as jest.Mock;

const payload: PushPayload = {
  title: 't',
  body: 'b',
  data: { type: 'bid' },
};

beforeEach(() => {
  jest.clearAllMocks();
  update.mockResolvedValue({});
});

describe('sendPushToUser', () => {
  test('returns empty array when user has no active tokens', async () => {
    findMany.mockResolvedValue([]);
    const r = await sendPushToUser('user-1', payload);
    expect(r).toEqual([]);
    expect(fcm).not.toHaveBeenCalled();
    expect(apns).not.toHaveBeenCalled();
  });

  test('routes IOS tokens to APNS, ANDROID tokens to FCM', async () => {
    findMany.mockResolvedValue([
      { id: 't-ios', platform: 'IOS', token: 'tok-ios', failureCount: 0 },
      { id: 't-and', platform: 'ANDROID', token: 'tok-and', failureCount: 0 },
    ]);
    apns.mockResolvedValue({ success: true });
    fcm.mockResolvedValue({ success: true });

    const r = await sendPushToUser('user-1', payload);
    expect(r).toHaveLength(2);
    expect(r.every((x) => x.success)).toBe(true);
    expect(apns).toHaveBeenCalledWith('tok-ios', payload);
    expect(fcm).toHaveBeenCalledWith('tok-and', payload);
  });

  test('deactivates token immediately on invalid-token error', async () => {
    findMany.mockResolvedValue([
      { id: 't-1', platform: 'ANDROID', token: 'dead', failureCount: 0 },
    ]);
    fcm.mockResolvedValue({
      success: false,
      error: new PushError('invalid-token', { providerReason: 'BadDeviceToken' }),
    });

    const r = await sendPushToUser('user-1', payload);
    expect(r[0]).toMatchObject({ success: false, errorCode: 'invalid-token' });
    expect(update).toHaveBeenCalledWith({
      where: { id: 't-1' },
      data: { isActive: false },
    });
  });

  test('increments failureCount on transient failures', async () => {
    findMany.mockResolvedValue([
      { id: 't-1', platform: 'ANDROID', token: 'flaky', failureCount: 2 },
    ]);
    fcm.mockResolvedValue({
      success: false,
      error: new PushError('rate-limited', { retryable: true }),
    });

    await sendPushToUser('user-1', payload);
    expect(update).toHaveBeenCalledWith({
      where: { id: 't-1' },
      data: { failureCount: 3 },
    });
  });

  test('deactivates token after 5 consecutive failures', async () => {
    findMany.mockResolvedValue([
      { id: 't-1', platform: 'ANDROID', token: 'flaky', failureCount: 4 },
    ]);
    fcm.mockResolvedValue({
      success: false,
      error: new PushError('unknown', { retryable: true }),
    });

    await sendPushToUser('user-1', payload);
    expect(update).toHaveBeenCalledWith({
      where: { id: 't-1' },
      data: { failureCount: 5, isActive: false },
    });
  });

  test('resets failureCount to 0 on success when previously > 0', async () => {
    findMany.mockResolvedValue([
      { id: 't-1', platform: 'ANDROID', token: 'recovered', failureCount: 2 },
    ]);
    fcm.mockResolvedValue({ success: true });

    await sendPushToUser('user-1', payload);
    expect(update).toHaveBeenCalledWith({
      where: { id: 't-1' },
      data: expect.objectContaining({ failureCount: 0 }),
    });
  });

  test('does not write to DB on success when failureCount is already 0', async () => {
    findMany.mockResolvedValue([
      { id: 't-1', platform: 'ANDROID', token: 'fresh', failureCount: 0 },
    ]);
    fcm.mockResolvedValue({ success: true });

    await sendPushToUser('user-1', payload);
    expect(update).not.toHaveBeenCalled();
  });

  test('never throws even if DB query fails', async () => {
    findMany.mockRejectedValue(new Error('db down'));
    const r = await sendPushToUser('user-1', payload);
    expect(r).toEqual([]);
  });

  test('isolates per-token failures so one bad token does not block others', async () => {
    findMany.mockResolvedValue([
      { id: 't-1', platform: 'ANDROID', token: 'a', failureCount: 0 },
      { id: 't-2', platform: 'IOS', token: 'b', failureCount: 0 },
    ]);
    fcm.mockRejectedValue(new Error('boom'));
    apns.mockResolvedValue({ success: true });

    const r = await sendPushToUser('user-1', payload);
    expect(r).toHaveLength(2);
    expect(r.find((x) => x.tokenId === 't-2')?.success).toBe(true);
    expect(r.find((x) => x.tokenId === 't-1')?.success).toBe(false);
  });
});
