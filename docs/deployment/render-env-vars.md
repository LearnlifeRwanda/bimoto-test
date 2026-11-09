# Render env vars — Bimoto API

Canonical list of environment variables for the production Render
deployment. Set these via the Render dashboard's **Environment** tab,
or use the `render.yaml` blueprint (which declares them with
`sync: false` so values stay in the dashboard, not in the repo).

> **Sensitivity legend:** `SECRET` = never log, never commit;
> `PUBLIC` = safe to log / share with developers.

## Required (must be set before first deploy)

| Variable | Sensitivity | Example | Notes |
|---|---|---|---|
| `DATABASE_URL` | SECRET | `postgresql://postgres.<ref>:<pwd>@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true` | From Supabase → Settings → Database → Connection Pooler URL. Use port 6543, not 5432. |
| `JWT_SECRET` | SECRET | (64+ random chars) | Generate: `openssl rand -base64 64` |
| `JWT_REFRESH_SECRET` | SECRET | (64+ random chars, different from above) | Generate: `openssl rand -base64 64` |
| `ENCRYPTION_KEY` | SECRET | (64 hex chars = 32 bytes) | Generate: `openssl rand -hex 32`. Used for at-rest field encryption. |
| `NODE_ENV` | PUBLIC | `production` | |
| `PORT` | PUBLIC | `3000` | Render injects this; default in code is 3000. |
| `CLIENT_URL` | PUBLIC | `https://bimoto.app` | Origin allowed by CORS. Without trailing slash. |

## Flutterwave (payments)

| Variable | Sensitivity | Source | Notes |
|---|---|---|---|
| `FLW_PUBLIC_KEY` | PUBLIC | Flutterwave dashboard → Settings → API | `FLWPUBK-...` |
| `FLW_SECRET_KEY` | SECRET | Flutterwave dashboard → Settings → API | `FLWSECK-...` |
| `FLW_SECRET_HASH` | SECRET | Set by you in Flutterwave dashboard webhook config | Used to verify webhook authenticity. |
| `FLW_ENCRYPTION_KEY` | SECRET | Flutterwave dashboard → Settings → API → "Encryption Key" | Distinct from the secret key. |
| `FLW_ENV` | PUBLIC | `sandbox` or `production` | Use `sandbox` until Flutterwave approves you for production. |

## Client build-time vars (Vite)

Unlike everything else in this file, these are **build-time** vars for
the client bundle, not runtime vars for the API service — set them on
whichever service builds `packages/client` (Render static site /
build pipeline), not on the API. Source of truth:
[`packages/client/.env.example`](../../packages/client/.env.example).

| Variable | Sensitivity | Source | Notes |
|---|---|---|---|
| `VITE_FLW_PUBLIC_KEY` | PUBLIC | Flutterwave dashboard → Settings → API | The *public* key (`FLWPUBK-...`), safe to ship in the client bundle — unlike `FLW_SECRET_KEY`, which stays server-side only. Required at build time for the in-browser card-payment widget. When unset, the card option fails fast with a "use Mobile Money" message; the MoMo flow is unaffected. |

## Africa's Talking (SMS)

| Variable | Sensitivity | Source | Notes |
|---|---|---|---|
| `AT_API_KEY` | SECRET | AT dashboard → Settings → API Key | |
| `AT_USERNAME` | PUBLIC | AT dashboard | `sandbox` for testing or your live username. |
| `AT_INBOUND_HMAC_SECRET` | SECRET | Set by you, also configured in AT dashboard webhook | Used to verify inbound SMS webhooks. |
| `AT_INBOUND_SHORTCODE` | PUBLIC | AT dashboard | e.g. `15555` (sandbox) or your purchased shortcode. |

## LocationIQ (geocoding)

| Variable | Sensitivity | Source | Notes |
|---|---|---|---|
| `LOCATIONIQ_API_KEY` | SECRET | LocationIQ dashboard → API Access Tokens | Server-side only — never expose to the client; the app calls `/api/geocode/*`, which proxies (and caches) LocationIQ. Optional: when unset, address autocomplete and reverse geocoding answer `503 GEOCODING_UNAVAILABLE` and the client quietly falls back to map + GPS — booking is unaffected. Free tier is ~5,000 requests/day; the server caches results for 24 h to stay inside it. |

## Sentry (error tracking)

| Variable | Sensitivity | Source | Notes |
|---|---|---|---|
| `SENTRY_DSN` | SECRET | Sentry project → Settings → Client Keys (DSN) | Optional; if unset, the Sentry SDK initialises with `enabled: false` and all reporting calls are no-ops. Init lives in `packages/server/src/instrument.ts`. |

## Push notifications (Firebase + APNS)

All five vars are optional — when missing, the push service degrades
to a no-op (logs one startup warning per provider). See
[mobile-push-setup.md](./mobile-push-setup.md) for the full
provisioning procedure.

| Variable | Sensitivity | Source | Notes |
|---|---|---|---|
| `FCM_SERVICE_ACCOUNT_JSON` | SECRET | Firebase Console → Project Settings → Service accounts → Generate new private key | Paste the entire JSON contents (raw). |
| `APNS_TEAM_ID` | SECRET | developer.apple.com → Membership → Team ID | 10-character string. |
| `APNS_KEY_ID` | SECRET | developer.apple.com → Keys → your APNS key | 10-character string. |
| `APNS_BUNDLE_ID` | PUBLIC | iOS project bundle id | `rw.bimoto.app` for the current build. |
| `APNS_PRIVATE_KEY` | SECRET | The `.p8` file contents | Newlines preserved or escaped as `\n` — `apns-client.ts` handles both. |
| `APNS_PRODUCTION` | PUBLIC | `true` or `false` | Default `true`. Set `false` only for Xcode-deployed dev devices. |

## Cron schedules (recommended defaults)

| Variable | Default | Notes |
|---|---|---|
| `BNR_TIMEZONE` | `Africa/Kigali` | Timezone for the BNR monthly report job. |
| `GRAPH_DETECTION_CRON` | `0 3 * * *` | Daily at 03:00 local time. |
| `MOBILITY_AGGREGATION_CRON` | `0 4 * * *` | Daily at 04:00 local time. |

## Optional / tuning

The codebase exposes ~80 additional env vars for tuning AML detection
thresholds, mobility-aggregation cell sizes, admin notification
templates, etc. All have sensible defaults — **do not set them unless
you know why**. Run `grep -r "process.env\." packages/server/src |
grep -v __tests__` for the full list. Document any you override in
this file with the chosen value and a one-line rationale.

## Generating secrets

```bash
# JWT_SECRET, JWT_REFRESH_SECRET (use distinct values for each)
openssl rand -base64 64

# ENCRYPTION_KEY (32 bytes = 64 hex chars)
openssl rand -hex 32

# AT_INBOUND_HMAC_SECRET, FLW_SECRET_HASH (32 bytes alphanumeric)
openssl rand -base64 32 | tr -d '/+=' | head -c 32
```

## Render-specific env vars

Render injects these automatically — you don't need to set them, but
the application reads them:

| Variable | Notes |
|---|---|
| `RENDER` | `true` when running on Render. |
| `RENDER_SERVICE_NAME` | e.g. `bimoto-api`. |
| `RENDER_GIT_COMMIT` | Full SHA of the deployed commit. The `/api/health` endpoint surfaces a short version of this. |
| `RENDER_GIT_BRANCH` | e.g. `main`. |
| `RENDER_INSTANCE_ID` | Per-container id, useful for log correlation. |

## Rotating secrets

1. Generate the new value (see above).
2. Update in Render dashboard → **Environment** → Save.
3. Render redeploys with the new value (~30 s).
4. Invalidate any out-of-band caches:
   - JWT rotation: existing tokens stay valid until expiry; force
     log-out by bumping users' `tokenVersion` if the schema supports
     it.
   - Flutterwave/AT secrets: also rotate in those vendor dashboards.

## Checklist (copy into your launch ticket)

- [ ] `DATABASE_URL` set (pooler, port 6543, `?pgbouncer=true`)
- [ ] `JWT_SECRET` set (fresh `openssl rand -base64 64`)
- [ ] `JWT_REFRESH_SECRET` set (different from above)
- [ ] `ENCRYPTION_KEY` set (fresh `openssl rand -hex 32`)
- [ ] `NODE_ENV=production`
- [ ] `CLIENT_URL` set
- [ ] All 5 `FLW_*` vars set with production values
- [ ] `VITE_FLW_PUBLIC_KEY` set on the client build (card option live)
- [ ] All 4 `AT_*` vars set
- [ ] `SENTRY_DSN` set (optional but recommended)
- [ ] First deploy succeeded
- [ ] `/api/health` returns `dbConnected: true`
