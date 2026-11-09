import { request } from '@playwright/test';

const API = process.env.E2E_API_URL || 'http://localhost:3000';
const CLIENT = process.env.E2E_BASE_URL || 'http://localhost:5173';

async function ping(url: string, label: string, attempts = 30, delayMs = 1000) {
  const ctx = await request.newContext();
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await ctx.get(url);
      if (res.ok() || res.status() === 404) {
        await ctx.dispose();
        return;
      }
    } catch {
      // server not up yet
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  await ctx.dispose();
  throw new Error(
    `[e2e] ${label} did not become reachable at ${url} after ${attempts * delayMs}ms. ` +
      `Start it with \`pnpm dev:server\` and \`pnpm dev:client\` (or rely on the CI workflow).`,
  );
}

export default async function globalSetup() {
  await ping(`${API}/api/health`, 'server');
  await ping(CLIENT, 'client');
}
