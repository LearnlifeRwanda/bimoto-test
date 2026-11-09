import { FlutterwaveError } from './errors';
import { config } from '../../config';
import { buildSimulatedClient } from './simulated-client';

let cachedClient: any = null;
let warnedNoKeys = false;

export interface FlwClient {
  Charge: any;
  MobileMoney: any;
  Transaction: any;
  Transfer: any;
}

function buildStubClient(): FlwClient {
  const fail = () => {
    throw new FlutterwaveError('NO_KEYS_CONFIGURED', { retryable: false });
  };
  const stub = new Proxy(
    {},
    {
      get: () => fail,
    },
  );
  return {
    Charge: stub,
    MobileMoney: stub,
    Transaction: stub,
    Transfer: stub,
  };
}

export function getClient(): FlwClient {
  if (cachedClient) return cachedClient;

  // PREPROTO-SIM G2 — the simulation branch comes BEFORE the key check:
  // simulated mode must never construct (or even consider) the real SDK.
  // The startup guard already guarantees no FLW_SECRET_KEY coexists with
  // this mode, so the live path below is unreachable while simulated.
  if (config.PAYMENTS_MODE === 'simulated') {
    cachedClient = buildSimulatedClient();
    return cachedClient;
  }

  const publicKey = process.env.FLW_PUBLIC_KEY;
  const secretKey = process.env.FLW_SECRET_KEY;

  if (!publicKey || !secretKey) {
    if (!warnedNoKeys) {
      console.warn('[PAYMENT] FLW keys not configured — using stub client');
      warnedNoKeys = true;
    }
    cachedClient = buildStubClient();
    return cachedClient;
  }

  // Lazy import: requiring flutterwave-node-v3 hits the network during
  // construction in some versions; we only want to pay that cost when the
  // operator has actually configured keys.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Flutterwave = require('flutterwave-node-v3');
  cachedClient = new Flutterwave(publicKey, secretKey);
  return cachedClient;
}

export function resetClientForTests(): void {
  cachedClient = null;
  warnedNoKeys = false;
}
