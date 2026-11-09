import * as Sentry from '@sentry/node';

// Sentry v8 uses OpenTelemetry-based auto-instrumentation that must
// be initialized before any module it intends to instrument is
// loaded. This file is imported as the very first line of index.ts
// for that reason. Do not move the init below into index.ts.
//
// When SENTRY_DSN is unset (dev, test), `enabled: false` makes init
// a no-op so the rest of the SDK surface (captureException,
// setupExpressErrorHandler) stays callable as no-ops too.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV ?? 'development',
  tracesSampleRate: 0.1,
  enabled: !!process.env.SENTRY_DSN,
});
