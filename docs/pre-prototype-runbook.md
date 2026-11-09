# Pre-prototype simulation runbook (PREPROTO-SIM)

How to run the whole Bimoto ride loop on a single laptop with **simulated
payments** and a **simulated SMS inbox** — no Flutterwave account, no
Africa's Talking account, no real money. A real driver and an
employee-customer complete a real ride on real GPS; the escrow, commission,
settlement and payout all run the production code against a faked gateway.

> **Security first.** In simulated mode the SMS inbox delivers login OTP
> codes — anyone who can read it can log in as anyone. Three layers keep it
> closed: (1) the inbox routes require an admin session or the
> `SIM_INBOX_TOKEN` header and answer 503 if no token is configured;
> (2) the token must be ≥32 characters and travels in a header, never a
> query string; (3) the whole pilot sits behind an edge access-gate
> (Cloudflare Access, below). Do not skip layer 3.

## 1. Machine setup (macOS)

```bash
# Node 20 + pnpm
brew install node@20 pnpm

# PostgreSQL
brew install postgresql@16
brew services start postgresql@16
createdb bimoto

# Clone + install
git clone <repo-url> bimoto && cd bimoto
pnpm install
```

## 2. Server configuration

Create `packages/server/.env`:

```bash
DATABASE_URL="postgresql://$(whoami)@localhost:5432/bimoto"

# Real random secrets — the server refuses known placeholder values.
JWT_SECRET="$(openssl rand -hex 32)"
JWT_REFRESH_SECRET="$(openssl rand -hex 32)"
ENCRYPTION_KEY="$(openssl rand -hex 32)"

# ---- PREPROTO-SIM ----
PAYMENTS_MODE=simulated
SMS_MODE=simulated
SIM_INBOX_TOKEN="$(openssl rand -hex 32)"     # >=32 chars, required for the inbox

# Pilot conveniences
SKIP_DRIVER_VERIFICATION=true                  # seeded drivers are VERIFIED anyway
LOCATIONIQ_API_KEY=<your-locationiq-key>       # optional; empty = map+GPS fallback
BUILD_SHA=<git-commit-of-this-bundle>          # release bundles should set this — /api/health surfaces it as `version` ("unknown" otherwise on zip deploys)

# Plain-HTTP local dev only; keep 'true' when serving through the tunnel
COOKIE_SECURE=false
```

Rules the server enforces at startup (it aborts, it does not warn):

- `PAYMENTS_MODE=simulated` with a non-empty `FLW_SECRET_KEY` → refuses to
  start. Simulated and real money can never be confused.
- `NODE_ENV=production` with any simulated mode → refuses to start unless
  `ALLOW_SIMULATED_IN_PROD=true` is set deliberately.
- `SIM_INBOX_TOKEN` set but shorter than 32 characters → refuses to start.

## 3. Database migrate + seed

```bash
cd packages/server
pnpm db:migrate:deploy   # applies all migrations incl. SimulatedMessage
pnpm db:seed             # empty databases only — see the refusals below
```

**The seed refuses rather than being idempotent.** It used to be safe to
re-run; it is not, and never was. It plants fixed-phone demo accounts whose
numbers are published in this repository, and on a keyless pilot
(`SMS_MODE=simulated`, recommended in §2) their login OTPs land in the
`/api/sim` inbox — so anyone who can read that inbox can log in as them.
Re-running it against a live pilot database re-plants accounts an operator
may have deliberately removed. It now refuses in three situations:

| Situation | What happens |
|---|---|
| `NODE_ENV=production` | Refuses. The seed is a development and CI fixture; create the first real admin deliberately. |
| The `User` table is not empty | Refuses, naming the row count. Point `DATABASE_URL` at a fresh database. |
| `ENCRYPTION_KEY` unset or not 64 hex characters | Refuses. It used to fall back to `'a'.repeat(64)`, which does not fail — it writes `phoneEncrypted` values the real server cannot decrypt, so every seeded account is silently unreadable. |

**The ADMIN and ANALYST accounts are opt-in.** `pnpm db:seed` no longer
creates them. Set `SEED_DEV_ADMIN=1` to get them, in development or CI
only (`.github/workflows/e2e.yml` does exactly this, because the e2e specs
log in as the admin). A pilot operator should not run with them: make a
real admin account on a number you control instead.

The seed provides:

| Account | Phone | Notes |
|---|---|---|
| TestCustomer | `+250781234567` | customer, consent pre-stamped |
| TestDriver | `+250789876543` | MOTO, **VERIFIED**, jacket `BM-SIM-001`, 5 000 RWF starting balance |
| TestBothUser | `+250782345678` | BIKE, VERIFIED, jacket `BM-SIM-002` |
| EBikeJean | `+250781000004` | E_BIKE, VERIFIED, jacket `BM-SIM-003` |
| PilotEmployee1–5 | `+250781000101`–`105` | customers, consent pre-stamped |
| Admin | `+250780000000` | admin role — **only with `SEED_DEV_ADMIN=1`**; published number, can read the sim inbox with their session |
| Analyst | `+250780000001` | read-only intel role — **only with `SEED_DEV_ADMIN=1`**; published number |

## 4. Run

```bash
# Terminal 1 — server
cd packages/server && pnpm dev

# Terminal 2 — client (web)
cd packages/client && pnpm dev
```

Check `http://localhost:3000/api/health` — it must report
`"paymentsMode":"simulated","smsMode":"simulated"`. The client reads this
and shows the persistent **“SIMULATION — no real money”** banner on every
authenticated screen.

Keep the Mac awake for the whole pilot window:

```bash
caffeinate -dims   # leave running in its own terminal
```

## 5. Logging in — reading OTPs from the simulated inbox

Every OTP and ride notification lands in the simulated inbox instead of a
phone. Two ways to read it:

```bash
# curl, with the token in a HEADER (never the query string)
curl -H "x-sim-inbox-token: $SIM_INBOX_TOKEN" http://localhost:3000/api/sim/messages

# filter for one participant
curl -H "x-sim-inbox-token: $SIM_INBOX_TOKEN" "http://localhost:3000/api/sim/messages?to=250781000101"
```

Or the HTML view at `http://localhost:3000/api/sim/inbox` — open it in a
browser where the **Admin** account is logged in (the admin session cookie
authorises it; it auto-refreshes every 5 s). The banner in the app links to
this page. Anyone without the token or an admin session gets 401 — and if
you forgot to set `SIM_INBOX_TOKEN`, the route answers 503 rather than
serving codes openly.

## 6. The doorway — Cloudflare Tunnel + Access

Participants' phones need to reach the laptop. Use a named Cloudflare
Tunnel and put **Cloudflare Access in front of it** — this is the edge
access-gate that keeps the pilot (and its OTP inbox) off the open internet.

```bash
brew install cloudflared
cloudflared tunnel login
cloudflared tunnel create bimoto-pilot
# route e.g. pilot-api.example.com -> http://localhost:3000
#            pilot.example.com     -> http://localhost:5173
cloudflared tunnel route dns bimoto-pilot pilot-api.example.com
cloudflared tunnel route dns bimoto-pilot pilot.example.com
cloudflared tunnel run bimoto-pilot
```

In the Cloudflare Zero Trust dashboard, create an Access application
covering both hostnames and restrict it to the pilot participants' emails
(One-time PIN policy is enough). **Do not expose the tunnel without
Access** — the inbox guard is the last line of defence, not the only one.

Then point the server at the app origin (config, not code):

```bash
# packages/server/.env
CORS_ORIGINS=https://pilot.example.com
TRUST_PROXY=true
COOKIE_SECURE=true
```

## 7. Android APK build

The Capacitor app bakes the API origin in at build time:

```bash
cd packages/client
VITE_API_URL=https://pilot-api.example.com pnpm build
npx cap sync android
npx cap open android    # build a debug APK in Android Studio, share with participants
```

**Which build is this?** `versionCode` / `versionName` live in two
one-line `def`s at the top of `packages/client/android/app/build.gradle`
and are 14 / `"14"` as of this cut. Bump both on every cut, or pass a
`version_name` when dispatching the **Android Build** workflow manually —
that run stamps it and then reads it back out of the assembled APK,
failing if the two disagree.

A tester can read it on the phone under **Settings → Apps → Bimoto →
version**, and it appears in any crash report. Before this cut the value
had been `1.0` since the project began, through every build the board
calls v1–v13, so "which build are you on?" had no answer.

## 8. The ride loop, end to end

1. Employee logs in (OTP read from the sim inbox by the operator, or by
   the employee via the Access-gated inbox page if you grant them the URL
   for their own number only — operator's call).
2. Employee posts a journey; the driver bids; the employee taps
   **“Pay (simulated)”** (the card option is hidden in simulated mode).
3. The escrow goes **HELD synchronously** — the simulated gateway returns
   a success-shaped charge, so the existing `POST /api/payments` flow
   flips it in-request; no webhook involved.
4. The ride runs on real GPS; completion and confirmation release the
   escrow, credit the driver's balance (real commission math, real
   bookkeeping — only the gateway was fake).
5. The payout job initiates a simulated transfer that clears immediately;
   the driver's payout SMS lands in the sim inbox.

## 9. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Server exits at startup mentioning `FLW_SECRET_KEY` | You have real gateway keys in the env while `PAYMENTS_MODE=simulated`. Remove them. |
| `/api/sim/*` answers 503 | `SIM_INBOX_TOKEN` unset (or too short) — set a ≥32-char token and restart. |
| `/api/sim/*` answers 401 | Wrong/missing token header and no admin session. |
| No SIMULATION banner in the app | The client couldn't read `/api/health`, or the server is in live mode. Check the health JSON. |
| Payment stays PENDING | The server is NOT in simulated mode (health says `live`) — in simulated mode HELD is synchronous. |
| Phones can't reach the app | Tunnel down, or Cloudflare Access policy doesn't include the participant. |
