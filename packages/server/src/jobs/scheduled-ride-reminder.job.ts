import prisma from '../prisma';
import { JourneyStatus, BookingMode, SOCKET_EVENTS } from '@bimoto/shared';
import { sendSms } from '../services/sms.service';
import { decryptedPhoneOrNull } from '../services/user-phone';
import { emitToJourney } from '../socket';
import { withJobLock } from '../services/job-lock';

let intervalId: NodeJS.Timeout | null = null;

const HOUR_MS = 60 * 60 * 1000;
const HALF_HOUR_MS = 30 * 60 * 1000;
const FIVE_MIN_MS = 5 * 60 * 1000;

const WINDOW_60 = 60;
const WINDOW_30 = 30;
const WINDOW_5 = 5;

function fmt(d: Date): string {
  return d.toISOString().slice(11, 16);
}

function reminderWindow(scheduledFor: Date, now: Date): 60 | 30 | 5 | null {
  const remaining = scheduledFor.getTime() - now.getTime();
  if (remaining <= FIVE_MIN_MS && remaining > 0) return WINDOW_5;
  if (remaining <= HALF_HOUR_MS && remaining > FIVE_MIN_MS) return WINDOW_30;
  if (remaining <= HOUR_MS && remaining > HALF_HOUR_MS) return WINDOW_60;
  return null;
}

function alreadySentForWindow(
  lastReminderSentAt: Date | null,
  scheduledFor: Date,
  windowMin: 60 | 30 | 5,
): boolean {
  if (!lastReminderSentAt) return false;
  const target = scheduledFor.getTime() - windowMin * 60 * 1000;
  return lastReminderSentAt.getTime() >= target;
}

export async function processScheduledRideReminders(now: Date = new Date()): Promise<number> {
  let sent = 0;
  try {
    const upcoming = await prisma.journey.findMany({
      where: {
        bookingMode: BookingMode.SCHEDULED,
        status: JourneyStatus.MATCHED,
        scheduledFor: { gte: new Date(now.getTime() - FIVE_MIN_MS), lte: new Date(now.getTime() + HOUR_MS + FIVE_MIN_MS) },
      },
      include: { customer: true, driver: true },
    });

    for (const journey of upcoming) {
      try {
        if (!journey.scheduledFor) continue;
        const win = reminderWindow(journey.scheduledFor, now);
        if (!win) continue;
        if (alreadySentForWindow(journey.lastReminderSentAt, journey.scheduledFor, win)) continue;

        const t = fmt(journey.scheduledFor);
        const customerPhone = decryptedPhoneOrNull(journey.customer);
        const driverPhone = decryptedPhoneOrNull(journey.driver);
        if (win === WINDOW_60 && customerPhone && journey.driver) {
          await sendSms(
            customerPhone,
            `Bimoto: your ride at ${t} - driver ${journey.driver.nickname} confirmed. Reply YES to confirm, CANCEL to cancel.`,
          ).catch((e) => console.error('[REMINDER] SMS error:', e));
        } else if (win === WINDOW_30 && driverPhone && journey.customer) {
          await sendSms(
            driverPhone,
            `Bimoto: ride at ${t}, head to pickup. Customer: ${journey.customer.nickname}. Reply YES to confirm, CANCEL to cancel.`,
          ).catch((e) => console.error('[REMINDER] SMS error:', e));
        } else if (win === WINDOW_5 && driverPhone) {
          await sendSms(
            driverPhone,
            `Bimoto: pickup in 5 min - confirm you're at ${journey.pickupName}. Reply YES to confirm, CANCEL to cancel.`,
          ).catch((e) => console.error('[REMINDER] SMS error:', e));
        } else {
          continue;
        }

        await prisma.journey.update({
          where: { id: journey.id },
          data: { lastReminderSentAt: now },
        });
        emitToJourney(journey.id, SOCKET_EVENTS.SCHEDULED_RIDE_REMINDER, {
          journeyId: journey.id,
          windowMinutes: win,
        });
        sent += 1;
      } catch (err) {
        console.error(`[REMINDER] Error reminding journey ${journey.id}:`, err);
      }
    }

    if (sent > 0) console.log(`[REMINDER] Sent ${sent} scheduled-ride reminder(s)`);
  } catch (err) {
    console.error('[REMINDER] Error processing scheduled-ride reminders:', err);
  }
  return sent;
}

export function startScheduledRideReminderJob() {
  console.log('[REMINDER] Starting scheduled-ride-reminder job (every 60s)');
  // withJobLock: only the advisory-lock leader runs the tick when
  // overlapping server processes race (deploy, scale-out).
  intervalId = setInterval(() => {
    withJobLock('scheduled-ride-reminder.job', () => processScheduledRideReminders()).catch((err) => {
      console.error('[REMINDER] Top-level tick failed:', err);
    });
  }, 60 * 1000);
  withJobLock('scheduled-ride-reminder.job', () => processScheduledRideReminders()).catch((err) => {
    console.error('[REMINDER] Top-level tick failed:', err);
  });
}

export function stopScheduledRideReminderJob() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
