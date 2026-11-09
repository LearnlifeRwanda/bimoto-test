import AfricasTalking from 'africastalking';
import prisma from '../prisma';
import { config } from '../config';
import { looksLikeCiphertext, ciphertextBreadcrumb } from '../utils/dialable';

// Lazy-init the SDK so importing this module doesn't crash when AT_API_KEY
// is empty (fresh dev env, CI without secrets, etc.). The constructor
// validates apiKey at call time, so we defer it until the first real send
// — by which point any unauthenticated path has already short-circuited
// via NODE_ENV === 'test' or development-mode logging.
let cachedSmsClient: ReturnType<typeof AfricasTalking>['SMS'] | null = null;

function getSmsClient() {
  if (cachedSmsClient) return cachedSmsClient;
  const at = AfricasTalking({
    apiKey: config.AT_API_KEY,
    username: config.AT_USERNAME,
  });
  cachedSmsClient = at.SMS;
  return cachedSmsClient;
}

// GROUNDSKEEPER G2 — phones are encrypted at rest in this codebase; a log
// line that prints one in full undoes that for anyone who can read stdout
// (Render's log stream, a rotated file, a screenshot). The tail is kept
// because an operator reading a delivery log needs to tell two recipients
// apart, and three digits does that without being the number.
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length <= 3) return '***';
  return `***${digits.slice(-3)}`;
}

export async function sendSms(phone: string, message: string): Promise<{ success: boolean }> {
  // DECRYPT v3 L4 — before every transport branch, including the
  // simulated one: a destination shaped like `iv:ct:tag` hex is encrypted
  // material that some caller forgot to put through
  // services/user-phone.ts. It is not dialable by any transport, so no
  // branch below should get the chance to "succeed" with it. Nine call
  // sites failed exactly this way before the schema rename; this is what
  // makes a tenth loud instead of silent. The value is never logged — it
  // is decryptable material.
  if (looksLikeCiphertext(phone)) {
    console.error(
      `[SMS] refused: destination is encrypted material, not a phone number ${ciphertextBreadcrumb(phone)}`,
    );
    return { success: false };
  }

  // PREPROTO-SIM G3 — simulated transport takes precedence over every
  // other branch: the message is persisted to the online inbox instead
  // of being sent. Caller-agnostic by design (OTP, freeze notices, ride
  // notifications — anything that reaches this choke point is captured).
  // The body is NOT logged: it can contain a login OTP, and the guarded
  // /api/sim inbox is the only place codes should be readable.
  if (config.SMS_MODE === 'simulated') {
    await prisma.simulatedMessage.create({
      data: { toPhone: phone, body: message },
    });
    // PILOT-GUARD Item 7 — masked here as it already is on the live
    // branch. This is the mode the startup guard RECOMMENDS for a
    // keyless pilot, so it is the branch a real pilot actually runs:
    // printing the number in full undoes at stdout exactly what
    // phoneEncrypted does at rest. The SimulatedMessage row above keeps
    // the whole number — the inbox has to be dialable and is guarded by
    // SIM_INBOX_TOKEN; the terminal scrollback is not.
    console.log(`[SMS-SIM] Captured message to ${maskPhone(phone)} in simulated inbox`);
    return { success: true };
  }

  if (process.env.NODE_ENV === 'test') {
    // PILOT-GUARD Item 7 — masked for the same reason, and because the
    // NODE_ENV=test branch is what CI logs and what a developer's
    // terminal shows. The body stays: this branch is unreachable outside
    // a test run, and the assertions that read it are what make the SMS
    // suites checkable.
    console.log(`[SMS-TEST] To: ${maskPhone(phone)} | Message: ${message}`);
    return { success: true };
  }

  // GROUNDSKEEPER G2 — this branch used to read
  // `if (!process.env.AT_API_KEY || NODE_ENV === 'development')`, and the
  // first half of that condition was a fail-open: a PRODUCTION server whose
  // AT_API_KEY was unset or misspelt sent no SMS at all, reported
  // `{ success: true }` to every caller including OTP issuance, and printed
  // the login codes to stdout. Nothing anywhere reported a fault.
  //
  // The key is no longer part of the decision. Which transport runs is the
  // explicit SMS_MODE switch (simulated, above) plus NODE_ENV; a production
  // server on SMS_MODE=live with no key now refuses to BOOT
  // (startup-guard.ts, assertSmsTransportSafety), so it can never reach here
  // and never silently swallow a send.
  //
  // The body is withheld for the same reason the simulated branch withholds
  // it: it can contain a login OTP, and a terminal scrollback is not where
  // account-takeover material should live. Run SMS_MODE=simulated and read
  // the codes from the guarded /api/sim inbox.
  if (process.env.NODE_ENV === 'development') {
    // PILOT-GUARD Item 7 — the body was already withheld here; the
    // destination was not.
    console.log(
      `[SMS-DEV] Would send to ${maskPhone(phone)} (body withheld — it can contain a login OTP)`,
    );
    return { success: true };
  }

  try {
    const sms = getSmsClient();
    const result = await sms.send({
      to: [phone],
      message,
      // from: 'BIMOTO',  // Uncomment when sender ID is registered with carriers
    });
    console.log(`[SMS] Sent to ${maskPhone(phone)}: ${JSON.stringify(result)}`);
    return { success: true };
  } catch (error) {
    console.error(`[SMS] Failed to send to ${maskPhone(phone)}:`, error);
    throw error;
  }
}
