// R3-CONFLICTS-NOTIFICATIONS — admin-side push pipeline.
//
// Where recipient-sms-notification.service.ts addresses parcel recipients
// (not Bimoto users; SMS-only channel) and notification.service.ts
// addresses end-users (push to the user's registered devices), this
// service is the THIRD audience: platform admins / ops staff.
//
// When a recipient SMS-disputes a delivery, the leg is stamped DISPUTED
// and surfaces on the admin conflicts dashboard — but admins only see
// it if they happen to be looking. This service closes that loop with
// a real-time push notification to every user with role === 'ADMIN'.
//
// The helper is fire-and-forget: the recipient-dispute handler MUST NOT
// block on push delivery, and a push failure MUST NOT roll back the
// DISPUTED stamp. Matches the established pattern from journey.service.ts
// + recipient-sms-notification.service.ts.

import * as Sentry from '@sentry/node';
import prisma from '../prisma';
import { sendPushToUser } from './push';
import type { PushPayload } from './push';

const DISPUTE_REASON_PREVIEW_CHARS = 60;

export interface RecipientDisputeNotificationArgs {
  legId: string;
  journeyId: string;
  customerNickname: string;
  recipientPhone: string;
  disputeReason: string;
}

export function composeRecipientDisputePayload(
  args: RecipientDisputeNotificationArgs,
): PushPayload {
  const reason = args.disputeReason ?? '';
  const truncated = reason.length > DISPUTE_REASON_PREVIEW_CHARS;
  const preview = truncated
    ? `${reason.slice(0, DISPUTE_REASON_PREVIEW_CHARS)}...`
    : reason;
  const nickname = args.customerNickname?.trim() || 'Customer';
  return {
    title: 'New recipient dispute',
    body: `${nickname}'s parcel disputed by ${args.recipientPhone}: ${preview}`,
    data: {
      type: 'admin-conflict',
      conflictType: 'CONFLICT_RECIPIENT_DISPUTE',
      legId: args.legId,
      journeyId: args.journeyId,
      deepLink: `/admin/conflicts/RECIPIENT_DISPUTE/${args.legId}`,
    },
  };
}

export function notifyAdminsOfNewRecipientDispute(
  args: RecipientDisputeNotificationArgs,
): void {
  void (async () => {
    try {
      const admins = await prisma.user.findMany({
        where: { role: 'ADMIN' },
        select: { id: true },
      });
      if (admins.length === 0) {
        Sentry.addBreadcrumb({
          category: 'admin-notification',
          message: 'No ADMIN users found when notifying recipient dispute',
          level: 'info',
          data: { legId: args.legId },
        });
        return;
      }
      const payload = composeRecipientDisputePayload(args);
      await Promise.allSettled(
        admins.map((admin: { id: string }) => sendPushToUser(admin.id, payload)),
      );
      Sentry.addBreadcrumb({
        category: 'admin-notification',
        message: 'Notified admins of new recipient dispute',
        level: 'info',
        data: { legId: args.legId, adminCount: admins.length },
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[admin-notifications] notifyAdminsOfNewRecipientDispute failed', err);
      Sentry.captureException(err, {
        tags: { event: 'admin_push_recipient_dispute' },
        extra: { legId: args.legId },
      });
    }
  })();
}
