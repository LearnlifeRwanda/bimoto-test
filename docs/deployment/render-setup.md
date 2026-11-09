# Render setup — Bimoto API

This is the operational playbook for deploying the Bimoto API to
[Render](https://render.com) using the `render.yaml` blueprint
committed at the repo root.

## Prerequisites

- A GitHub account with access to `Joschll/bimoto`.
- A Render account (free tier is fine to start; upgrade to Starter
  $7/mo if free-tier sleep is unacceptable).
- A Supabase project — see
  [`supabase-setup.md`](./supabase-setup.md). You need the
  `DATABASE_URL` connection string before starting here.
- The full env-var list — see [`render-env-vars.md`](./render-env-vars.md).

## One-time setup

1. **Sign up / sign in** at <https://render.com>.
2. Click **New** → **Blueprint** → connect your GitHub account →
   select `Joschll/bimoto` → choose the `main` branch.
3. Render will detect `render.yaml` at the repo root and propose the
   `bimoto-api` web service. Click **Apply**.
4. On the service detail page, open the **Environment** tab. Render
   will list the `sync: false` variables from `render.yaml` as
   "missing" — paste each value in. See
   [`render-env-vars.md`](./render-env-vars.md) for the canonical list.
5. Save. Render kicks off the first deploy. First build is ~5–10
   minutes (subsequent deploys are faster thanks to layer caching).
6. Once the deploy is **Live**, Render assigns a URL like
   `https://bimoto-api.onrender.com`. Hit `/api/health` — it should
   return `{"status":"ok","dbConnected":true,...}`.

## Manual setup (without the blueprint)

If for any reason you want to skip `render.yaml` and configure the
service by hand:

1. **New** → **Web Service** → connect repo → select `Joschll/bimoto`.
2. Configure:
   - **Name:** `bimoto-api`
   - **Region:** `Frankfurt` (closest to Kigali on free tier)
   - **Branch:** `main`
   - **Runtime:** `Docker`
   - **Dockerfile path:** `packages/server/Dockerfile`
   - **Docker Context Directory:** `.` (repo root — this is critical;
     the Dockerfile COPYs workspace manifests from the repo root)
   - **Auto-Deploy:** `Yes`
   - **Health check path:** `/api/health`
   - **Plan:** Free tier (or Starter $7/mo)
3. Add env vars (see [`render-env-vars.md`](./render-env-vars.md)).
4. **Create Web Service**.

## Auto-deploy behaviour

- Every push to `main` triggers a build + deploy.
- Render runs `prisma migrate deploy` automatically on container
  start (this is the `CMD` in the Dockerfile), so committed
  migrations apply on every deploy with no manual step.
- If a deploy fails, the previous container keeps serving traffic
  (zero-downtime deploys are the Render default).

## After-deploy checklist

- [ ] Hit `https://bimoto-api.onrender.com/api/health` — expect 200
      with `dbConnected: true`.
- [ ] Hit `https://bimoto-api.onrender.com/api/docs` — expect Swagger
      UI to load.
- [ ] Update the client's `VITE_API_URL` (in your client deployment
      config or `.env.production`) to the Render URL.
- [ ] Configure the Flutterwave webhook URL in the Flutterwave
      dashboard: `https://bimoto-api.onrender.com/api/webhooks/flutterwave`.
- [ ] Configure the Africa's Talking inbound SMS callback URL:
      `https://bimoto-api.onrender.com/api/sms/inbound`.
- [ ] Verify Sentry is receiving events (trigger a deliberate error
      from the admin tools and check the Sentry dashboard).

## Free-tier notes

The free Web Service plan **sleeps after 15 minutes of inactivity**.
First request after sleep takes ~30 seconds to wake. For pilot
testing this is usually fine; for live operations upgrade to **Starter**
($7/mo) which keeps the service warm.

The free tier also has a **750-hour monthly cap** across all free
services on the account — plenty for a single service running 24/7.

## Custom domain (optional)

1. In Render dashboard → service → **Settings** → **Custom Domains**
   → **Add Custom Domain**.
2. Enter `api.bimoto.rw` (or whatever).
3. Render gives you a CNAME to add at your DNS provider.
4. Once DNS propagates (5 min – 48 h), Render auto-provisions a
   Let's Encrypt cert.
5. Update `CLIENT_URL` env var if needed and redeploy.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Build hangs at `pnpm install` | Check Render's free-tier disk quota; clear build cache via dashboard. |
| `prisma migrate deploy` fails on start | `DATABASE_URL` env var missing or wrong; check Supabase connection-pooler URL is used (port 6543, with `?pgbouncer=true`). |
| Health check returns 503 | Render won't route traffic; check **Logs** for startup errors (often a missing env var). |
| 502 in production | Container crashed; check logs. Render auto-restarts on crash. |
| Slow cold starts on free tier | Upgrade to Starter ($7/mo). |

See [`runbook.md`](./runbook.md) for day-to-day operational tasks.
