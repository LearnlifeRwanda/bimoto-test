import type { PushPayload } from './types';
import { PushError } from './errors';

let cachedAdmin: any = null;
let cachedMessaging: any = null;
let warnedNoKeys = false;

interface FcmSendResult {
  success: boolean;
  error?: PushError;
}

function logNoServiceAccount(reason: string): void {
  if (!warnedNoKeys) {
    console.warn(`[PUSH/FCM] disabled — ${reason}`);
    warnedNoKeys = true;
  }
}

function getMessaging(): any | null {
  if (cachedMessaging) return cachedMessaging;

  const raw = process.env.FCM_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    logNoServiceAccount('FCM_SERVICE_ACCOUNT_JSON not set');
    return null;
  }

  let serviceAccount: Record<string, unknown>;
  try {
    serviceAccount = JSON.parse(raw);
  } catch (err) {
    logNoServiceAccount(`FCM_SERVICE_ACCOUNT_JSON not valid JSON (${(err as Error).message})`);
    return null;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const admin = require('firebase-admin');
    if (!cachedAdmin) {
      const existing = admin.apps?.find((a: any) => a?.name === 'bimoto-push');
      cachedAdmin =
        existing ??
        admin.initializeApp(
          { credential: admin.credential.cert(serviceAccount as any) },
          'bimoto-push',
        );
    }
    cachedMessaging = admin.messaging(cachedAdmin);
    return cachedMessaging;
  } catch (err) {
    logNoServiceAccount(`firebase-admin init failed: ${(err as Error).message}`);
    return null;
  }
}

function classifyFcmError(err: any): PushError {
  const code: string | undefined = err?.errorInfo?.code ?? err?.code;
  if (
    code === 'messaging/registration-token-not-registered' ||
    code === 'messaging/invalid-registration-token' ||
    code === 'messaging/invalid-argument'
  ) {
    return new PushError('invalid-token', { retryable: false, providerReason: code });
  }
  if (code === 'messaging/quota-exceeded' || code === 'messaging/server-unavailable') {
    return new PushError('rate-limited', { retryable: true, providerReason: code });
  }
  if (code === 'messaging/authentication-error') {
    return new PushError('auth-failed', { retryable: false, providerReason: code });
  }
  return new PushError('unknown', {
    retryable: true,
    providerReason: code ?? (err?.message as string) ?? undefined,
  });
}

export async function sendFcm(token: string, payload: PushPayload): Promise<FcmSendResult> {
  const messaging = getMessaging();
  if (!messaging) {
    return {
      success: false,
      error: new PushError('auth-failed', { providerReason: 'fcm-not-configured' }),
    };
  }

  const message = {
    token,
    notification: {
      title: payload.title,
      body: payload.body,
    },
    data: payload.data ? toStringMap(payload.data) : undefined,
    android: {
      priority: 'high' as const,
    },
  };

  try {
    await messaging.send(message);
    return { success: true };
  } catch (err) {
    return { success: false, error: classifyFcmError(err) };
  }
}

function toStringMap(data: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v == null) continue;
    out[k] = typeof v === 'string' ? v : String(v);
  }
  return out;
}

export function resetFcmClientForTests(): void {
  cachedAdmin = null;
  cachedMessaging = null;
  warnedNoKeys = false;
}
