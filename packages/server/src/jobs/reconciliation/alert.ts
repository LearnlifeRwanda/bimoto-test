import * as Sentry from '@sentry/node';
import { sendSms } from '../../services/sms.service';
import type { DiffResult } from './ledger-diff';

export async function alertOnDrift(result: DiffResult): Promise<void> {
  const driftCount =
    result.missingFromLedger.length +
    result.missingFromGateway.length +
    result.statusMismatch.length;
  if (driftCount === 0) return;

  const summary =
    `Bimoto reconciliation drift: ` +
    `missingLedger=${result.missingFromLedger.length}, ` +
    `missingGateway=${result.missingFromGateway.length}, ` +
    `statusMismatch=${result.statusMismatch.length}`;

  if (process.env.SENTRY_DSN) {
    try {
      Sentry.captureMessage(summary, 'warning' as any);
    } catch (err) {
      console.error('[RECONCILIATION] Sentry capture failed:', err);
    }
  }

  const adminPhone = process.env.ADMIN_ALERT_PHONE;
  if (adminPhone) {
    try {
      await sendSms(adminPhone, summary);
    } catch (err) {
      console.error('[RECONCILIATION] Admin SMS failed:', err);
    }
  }
}
