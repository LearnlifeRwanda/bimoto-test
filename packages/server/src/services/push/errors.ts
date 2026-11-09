export type PushErrorCode =
  | 'invalid-token'
  | 'rate-limited'
  | 'auth-failed'
  | 'unknown';

export class PushError extends Error {
  public readonly code: PushErrorCode;
  public readonly retryable: boolean;
  public readonly providerReason?: string;

  constructor(
    code: PushErrorCode,
    opts: { retryable?: boolean; providerReason?: string } = {},
  ) {
    super(`Push: ${code}${opts.providerReason ? ` — ${opts.providerReason}` : ''}`);
    this.name = 'PushError';
    this.code = code;
    this.retryable = opts.retryable ?? false;
    this.providerReason = opts.providerReason;
  }
}
