import type { PushPayload } from './types';
import { PushError } from './errors';

let cachedProvider: any = null;
let cachedConfig: ApnsConfig | null = null;
let warnedNoKeys = false;

interface ApnsConfig {
  teamId: string;
  keyId: string;
  bundleId: string;
  privateKey: string;
  production: boolean;
}

interface ApnsSendResult {
  success: boolean;
  error?: PushError;
}

function logNoConfig(reason: string): void {
  if (!warnedNoKeys) {
    console.warn(`[PUSH/APNS] disabled — ${reason}`);
    warnedNoKeys = true;
  }
}

function readConfig(): ApnsConfig | null {
  const teamId = process.env.APNS_TEAM_ID;
  const keyId = process.env.APNS_KEY_ID;
  const bundleId = process.env.APNS_BUNDLE_ID;
  // .p8 keys are typically stored in env with literal `\n` for newlines.
  const privateKey = process.env.APNS_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!teamId || !keyId || !bundleId || !privateKey) {
    logNoConfig('APNS_TEAM_ID / APNS_KEY_ID / APNS_BUNDLE_ID / APNS_PRIVATE_KEY not all set');
    return null;
  }

  return {
    teamId,
    keyId,
    bundleId,
    privateKey,
    production: process.env.APNS_PRODUCTION !== 'false',
  };
}

function getProvider(): { provider: any; config: ApnsConfig } | null {
  if (cachedProvider && cachedConfig) {
    return { provider: cachedProvider, config: cachedConfig };
  }

  const config = readConfig();
  if (!config) return null;

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const apn = require('@parse/node-apn');
    cachedProvider = new apn.Provider({
      token: {
        key: config.privateKey,
        keyId: config.keyId,
        teamId: config.teamId,
      },
      production: config.production,
    });
    cachedConfig = config;
    return { provider: cachedProvider, config };
  } catch (err) {
    logNoConfig(`@parse/node-apn init failed: ${(err as Error).message}`);
    return null;
  }
}

function classifyApnsError(reason: string | undefined, status: number | undefined): PushError {
  if (status === 410 || reason === 'BadDeviceToken' || reason === 'Unregistered') {
    return new PushError('invalid-token', { retryable: false, providerReason: reason });
  }
  if (status === 429 || reason === 'TooManyRequests') {
    return new PushError('rate-limited', { retryable: true, providerReason: reason });
  }
  if (status === 403 || reason === 'InvalidProviderToken' || reason === 'ExpiredProviderToken') {
    return new PushError('auth-failed', { retryable: false, providerReason: reason });
  }
  return new PushError('unknown', { retryable: true, providerReason: reason });
}

export async function sendApns(token: string, payload: PushPayload): Promise<ApnsSendResult> {
  const handle = getProvider();
  if (!handle) {
    return {
      success: false,
      error: new PushError('auth-failed', { providerReason: 'apns-not-configured' }),
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const apn = require('@parse/node-apn');
  const note = new apn.Notification();
  note.topic = handle.config.bundleId;
  note.alert = { title: payload.title, body: payload.body };
  note.sound = 'default';
  note.contentAvailable = true;
  if (payload.data) note.payload = { ...payload.data };

  try {
    const result = await handle.provider.send(note, token);
    if (result.failed && result.failed.length > 0) {
      const f = result.failed[0];
      const reason: string | undefined = f.response?.reason ?? f.error?.message;
      const status: number | undefined = f.status ? Number(f.status) : undefined;
      return { success: false, error: classifyApnsError(reason, status) };
    }
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: new PushError('unknown', {
        retryable: true,
        providerReason: (err as Error).message,
      }),
    };
  }
}

export function resetApnsClientForTests(): void {
  if (cachedProvider?.shutdown) {
    try {
      cachedProvider.shutdown();
    } catch {
      // ignore
    }
  }
  cachedProvider = null;
  cachedConfig = null;
  warnedNoKeys = false;
}
