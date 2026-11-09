import { PrismaClient } from '@prisma/client';
import { config } from './config';

// DB-RESILIENCE G1 — one shared client, explicitly configured for the
// single-machine pilot instead of Prisma's CPU-derived defaults.
//
// Pool sizing: withJobLock holds one pooled connection per lock
// transaction for a tick's whole runtime, and seventeen interval jobs
// can in the worst case all tick at once. 17 lock transactions + their
// short queries on the shared pool + the health probe + real request
// traffic must all fit WITHOUT queueing behind each other, or a brief
// database blip turns into pool starvation. 30 covers that with
// headroom and stays well under Postgres's default max_connections=100
// even with a second overlapping server process during a deploy.
//
// connect_timeout bounds how long a single connection attempt can hang
// (a dead socket after machine sleep would otherwise wait the OS TCP
// timeout); pool_timeout bounds waiting for a free pool slot. Values
// come from config (DB_POOL_SIZE / DB_POOL_TIMEOUT_SECONDS /
// DB_CONNECT_TIMEOUT_SECONDS) and are applied as URL parameters —
// Prisma's only pool-configuration surface. A parameter already present
// in DATABASE_URL wins over the config default.

function withDefaultParam(url: string, key: string, value: string): string {
  const [base, query = ''] = url.split('?');
  if (query.split('&').some((p) => p.startsWith(`${key}=`))) return url;
  return `${base}?${query ? `${query}&` : ''}${key}=${value}`;
}

// Unit tests mock ../config with partial objects; without a URL the
// client is constructed exactly as before (env-driven, never queried).
const datasourceUrl = config.DATABASE_URL
  ? (
      [
        ['connection_limit', String(config.DB_POOL_SIZE)],
        ['pool_timeout', String(config.DB_POOL_TIMEOUT_SECONDS)],
        ['connect_timeout', String(config.DB_CONNECT_TIMEOUT_SECONDS)],
      ] as const
    ).reduce((url, [key, value]) => withDefaultParam(url, key, value), config.DATABASE_URL)
  : undefined;

const prisma = new PrismaClient({
  ...(datasourceUrl ? { datasources: { db: { url: datasourceUrl } } } : {}),
  log: [
    { emit: 'event', level: 'error' },
    { emit: 'event', level: 'warn' },
  ],
});

prisma.$on('error', (e) => {
  console.error(`[PRISMA] ${e.timestamp.toISOString()} error: ${e.message} (target: ${e.target})`);
});
prisma.$on('warn', (e) => {
  console.warn(`[PRISMA] ${e.timestamp.toISOString()} warn: ${e.message} (target: ${e.target})`);
});

export default prisma;
