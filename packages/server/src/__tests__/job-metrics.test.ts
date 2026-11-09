jest.mock('@sentry/node', () => ({
  addBreadcrumb: jest.fn(),
  captureMessage: jest.fn(),
}));

import * as Sentry from '@sentry/node';
import {
  LEASE_TTL_WARN_FRACTION,
  emitJobRunMetrics,
} from '../services/job-metrics';

describe('emitJobRunMetrics', () => {
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  const oldDsn = process.env.SENTRY_DSN;

  beforeEach(() => {
    jest.clearAllMocks();
    logSpy = jest.spyOn(console, 'log').mockImplementation();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    process.env.SENTRY_DSN = 'https://fake@sentry.example/1';
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    if (oldDsn === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = oldDsn;
  });

  it('emits the stable completion line with fields in order and durationMs last', () => {
    emitJobRunMetrics({
      prefix: '[MOBILITY]',
      job: 'mobility-aggregation.job',
      fields: { points: 1200, aggregates: 34, suppressed: 5 },
      durationMs: 6789,
      leaseTtlMs: 120 * 60 * 1000,
    });
    expect(logSpy).toHaveBeenCalledWith(
      '[MOBILITY] run complete: points=1200 aggregates=34 suppressed=5 durationMs=6789',
    );
  });

  it('mirrors the fields onto a Sentry breadcrumb', () => {
    emitJobRunMetrics({
      prefix: '[BNR-MONTHLY]',
      job: 'bnr-monthly.job',
      fields: { period: '2026-06', rows: 61 },
      durationMs: 1234,
      leaseTtlMs: 60 * 60 * 1000,
    });
    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'job',
        message: 'bnr-monthly.job run complete',
        data: { period: '2026-06', rows: 61, durationMs: 1234 },
      }),
    );
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('raises a Sentry warning when the run exceeds half the lease TTL', () => {
    const ttl = 60 * 60 * 1000;
    emitJobRunMetrics({
      prefix: '[BNR-MONTHLY]',
      job: 'bnr-monthly.job',
      fields: { period: '2026-06', rows: 61 },
      durationMs: ttl * LEASE_TTL_WARN_FRACTION + 1,
      leaseTtlMs: ttl,
    });
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'bnr-monthly.job run exceeded half its lease TTL',
      expect.objectContaining({ level: 'warning' }),
    );
    expect(warnSpy).toHaveBeenCalled();
  });

  it('stays silent at exactly half the lease TTL', () => {
    const ttl = 60 * 60 * 1000;
    emitJobRunMetrics({
      prefix: '[GPS-RETENTION]',
      job: 'gps-retention.job',
      fields: { deleted: 0, batches: 1 },
      durationMs: ttl * LEASE_TTL_WARN_FRACTION,
      leaseTtlMs: ttl,
    });
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('skips Sentry entirely when SENTRY_DSN is unset, but still logs', () => {
    delete process.env.SENTRY_DSN;
    emitJobRunMetrics({
      prefix: '[MOBILITY]',
      job: 'mobility-aggregation.job',
      fields: { points: 1 },
      durationMs: Number.MAX_SAFE_INTEGER,
      leaseTtlMs: 1,
    });
    expect(Sentry.addBreadcrumb).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });
});
