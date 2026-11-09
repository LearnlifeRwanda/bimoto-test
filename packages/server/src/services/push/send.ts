import * as Sentry from '@sentry/node';
import { PushPlatform } from '@prisma/client';
import prisma from '../../prisma';
import type { PushPayload } from './types';
import { sendFcm } from './fcm-client';
import { sendApns } from './apns-client';
import type { PushError } from './errors';

const FAILURE_DEACTIVATION_THRESHOLD = 5;

export interface PushSendResult {
  tokenId: string;
  platform: PushPlatform;
  success: boolean;
  errorCode?: PushError['code'];
  providerReason?: string;
}

async function deactivateToken(tokenId: string): Promise<void> {
  await prisma.deviceToken.update({
    where: { id: tokenId },
    data: { isActive: false },
  });
}

async function bumpFailureCount(tokenId: string, current: number): Promise<void> {
  const next = current + 1;
  if (next >= FAILURE_DEACTIVATION_THRESHOLD) {
    await prisma.deviceToken.update({
      where: { id: tokenId },
      data: { failureCount: next, isActive: false },
    });
  } else {
    await prisma.deviceToken.update({
      where: { id: tokenId },
      data: { failureCount: next },
    });
  }
}

async function resetFailureCount(tokenId: string, currentFailureCount: number): Promise<void> {
  if (currentFailureCount === 0) return;
  await prisma.deviceToken.update({
    where: { id: tokenId },
    data: { failureCount: 0, lastSeenAt: new Date() },
  });
}

export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
): Promise<PushSendResult[]> {
  let tokens: Awaited<ReturnType<typeof prisma.deviceToken.findMany>>;
  try {
    tokens = await prisma.deviceToken.findMany({
      where: { userId, isActive: true },
    });
  } catch (err) {
    Sentry.captureException(err);
    return [];
  }

  if (tokens.length === 0) return [];

  const results = await Promise.all(
    tokens.map(async (t): Promise<PushSendResult> => {
      try {
        const send = t.platform === PushPlatform.IOS ? sendApns : sendFcm;
        const r = await send(t.token, payload);
        if (r.success) {
          await resetFailureCount(t.id, t.failureCount);
          return { tokenId: t.id, platform: t.platform, success: true };
        }
        const error = r.error;
        if (error?.code === 'invalid-token') {
          await deactivateToken(t.id);
        } else {
          await bumpFailureCount(t.id, t.failureCount);
        }
        return {
          tokenId: t.id,
          platform: t.platform,
          success: false,
          errorCode: error?.code,
          providerReason: error?.providerReason,
        };
      } catch (err) {
        // Defensive: never let push delivery throw out of the caller.
        Sentry.captureException(err);
        return {
          tokenId: t.id,
          platform: t.platform,
          success: false,
          errorCode: 'unknown',
          providerReason: (err as Error).message,
        };
      }
    }),
  );

  return results;
}
