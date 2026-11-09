export type FlwErrorCode =
  | 'NO_KEYS_CONFIGURED'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'VALIDATION_ERROR'
  | 'INSUFFICIENT_FUNDS'
  | 'INVALID_WALLET'
  | 'GATEWAY_DOWN'
  | 'NOT_FOUND'
  // Card-charge verification guards (R3-PAYMENT-CARD-SERVER): the gateway
  // disagreed with what the client widget reported.
  | 'VERIFICATION_FAILED'
  | 'AMOUNT_MISMATCH'
  | 'TXID_MISMATCH'
  | 'UNKNOWN';

export class FlutterwaveError extends Error {
  public readonly code: FlwErrorCode;
  public readonly httpStatus?: number;
  public readonly flwReason?: string;
  public readonly retryable: boolean;

  constructor(
    code: FlwErrorCode,
    opts: { httpStatus?: number; flwReason?: string; retryable?: boolean } = {},
  ) {
    super(`Flutterwave: ${code}${opts.flwReason ? ` — ${opts.flwReason}` : ''}`);
    this.name = 'FlutterwaveError';
    this.code = code;
    this.httpStatus = opts.httpStatus;
    this.flwReason = opts.flwReason;
    this.retryable = opts.retryable ?? false;
  }
}

interface RawErrorLike {
  code?: string;
  message?: string;
  response?: {
    status?: number;
    data?: { message?: string; status?: string };
  };
  status?: string;
  message_text?: string;
}

export function mapFlwError(raw: unknown): FlutterwaveError {
  if (raw instanceof FlutterwaveError) return raw;

  const e = (raw ?? {}) as RawErrorLike;
  const httpStatus = e.response?.status;
  const flwReason =
    e.response?.data?.message ?? e.message_text ?? e.message ?? undefined;

  // Network / timeout
  if (e.code === 'ECONNABORTED' || /timeout/i.test(e.message ?? '')) {
    return new FlutterwaveError('TIMEOUT', { httpStatus, flwReason, retryable: true });
  }
  if (
    e.code === 'ECONNREFUSED' ||
    e.code === 'ENOTFOUND' ||
    e.code === 'ECONNRESET' ||
    /network/i.test(e.message ?? '')
  ) {
    return new FlutterwaveError('NETWORK_ERROR', { httpStatus, flwReason, retryable: true });
  }

  // 5xx — gateway down
  if (httpStatus && httpStatus >= 500) {
    return new FlutterwaveError('GATEWAY_DOWN', { httpStatus, flwReason, retryable: true });
  }

  // 4xx — categorise by reason text
  if (httpStatus && httpStatus >= 400) {
    const r = (flwReason ?? '').toLowerCase();
    if (/insufficient/.test(r) || /low.*balance/.test(r)) {
      return new FlutterwaveError('INSUFFICIENT_FUNDS', { httpStatus, flwReason, retryable: false });
    }
    if (/invalid.*(wallet|account|phone|msisdn)/.test(r) || /wallet.*not.*found/.test(r)) {
      return new FlutterwaveError('INVALID_WALLET', { httpStatus, flwReason, retryable: false });
    }
    if (httpStatus === 404) {
      return new FlutterwaveError('NOT_FOUND', { httpStatus, flwReason, retryable: false });
    }
    return new FlutterwaveError('VALIDATION_ERROR', { httpStatus, flwReason, retryable: false });
  }

  return new FlutterwaveError('UNKNOWN', { flwReason, retryable: false });
}
