# Mobile push notification setup

Bimoto delivers push notifications to native apps via two providers:

- **FCM** (Firebase Cloud Messaging) — Android
- **APNS** (Apple Push Notification service) — iOS

Both legs are configured per-environment via server env vars + a small
amount of native config in the client repo. The server code degrades
to a no-op (with a single startup warning) when the secrets are not
configured, so dev / preview environments without push secrets still
boot cleanly.

This document is the one-stop runbook for getting a real device
receiving real pushes from a deployed Bimoto server.

---

## 1 — Android (FCM)

### 1.1 Create the Firebase project (one-time, per environment)

1. Open <https://console.firebase.google.com> and create a project
   (e.g. `bimoto-prod`, `bimoto-staging`).
2. Inside the project, **Add app → Android**.
3. Use the package name `rw.bimoto.app` (matches `applicationId` in
   `packages/client/android/app/build.gradle`).
4. Skip the SHA-1 (not required for FCM-only — only Auth flows need
   it).
5. Download the generated `google-services.json` file.

### 1.2 Place `google-services.json` in the client repo

```bash
cp ~/Downloads/google-services.json packages/client/android/app/google-services.json
```

The real file is gitignored. The committed `google-services.json.example`
is a placeholder template and exists only to make the file's expected
shape visible in code review.

When the real file is present, the existing try/catch block in
`packages/client/android/app/build.gradle` auto-applies the
`com.google.gms.google-services` Gradle plugin. No build.gradle edit
is required.

### 1.3 Generate the server-side service-account key

1. In Firebase Console → **Project Settings → Service accounts**.
2. **Generate new private key** → downloads a JSON file.
3. Open the JSON and copy the entire contents (including outer braces).
4. Set it as `FCM_SERVICE_ACCOUNT_JSON` on Render:

   ```
   FCM_SERVICE_ACCOUNT_JSON='{"type":"service_account","project_id":"bimoto-prod",...}'
   ```

   Render's secret store accepts the raw JSON string. No escaping
   needed beyond what the Render UI does automatically.

---

## 2 — iOS (APNS)

### 2.1 Create the APNS .p8 auth key (one-time)

1. <https://developer.apple.com> → **Certificates, Identifiers & Profiles**
   → **Keys** → `+`.
2. Name: `Bimoto APNS`. Check **Apple Push Notifications service (APNs)**.
3. Continue → Register → Download. You can only download the .p8 file
   **once** — store it in 1Password / your secret manager
   immediately.
4. Note the 10-character **Key ID** (shown in the key detail page).

### 2.2 Note your Team ID + Bundle ID

- **Team ID**: `developer.apple.com` → Membership → Team ID
  (10-character string).
- **Bundle ID**: `rw.bimoto.app` (matches `PRODUCT_BUNDLE_IDENTIFIER`
  in `packages/client/ios/App/App.xcodeproj/project.pbxproj`).

### 2.3 Configure the server env vars

Set these on Render (all `sync: false` secrets):

| Variable | Value |
| --- | --- |
| `APNS_TEAM_ID` | Your 10-character team ID |
| `APNS_KEY_ID` | The Key ID from step 2.1 |
| `APNS_BUNDLE_ID` | `rw.bimoto.app` |
| `APNS_PRIVATE_KEY` | Contents of the `.p8` file |
| `APNS_PRODUCTION` | `true` for prod / TestFlight, `false` for Xcode-deployed dev builds |

> ⚠️ **`.p8` newline encoding gotcha.** The `.p8` file contains
> `-----BEGIN PRIVATE KEY-----` / `-----END PRIVATE KEY-----` markers
> separated by literal newlines. When pasting into Render, you can
> paste it raw (Render preserves newlines), OR encode newlines as
> `\n` strings — `apns-client.ts` accepts either form (it does a
> `.replace(/\\n/g, '\n')` on read). If iOS pushes silently fail
> with `403 InvalidProviderToken`, the key formatting is the most
> common cause. Use the `POST /api/admin/push/test` endpoint
> (Group 4) to surface the exact APNS reason code.

### 2.4 Native iOS project config (already committed)

The following are already in the repo as of Dispatch R2 — reviewers
do not need to add them, but the list documents what's expected:

- `packages/client/ios/App/App/App.entitlements` — declares
  `aps-environment = production`. Production is correct for both
  TestFlight and the App Store; only switch to `development` if
  you're deploying via Xcode → "My Mac" → device for raw debug
  builds.
- `packages/client/ios/App/App/Info.plist` — has
  `UIBackgroundModes = [remote-notification]` so the app can wake
  on a silent push.
- `packages/client/ios/App/App.xcodeproj/project.pbxproj` — has the
  Push Notifications system capability enabled and the entitlements
  file wired into both Debug and Release build configurations.

---

## 3 — Verify end-to-end

After secrets are configured and the app is on a physical device:

1. Launch the app and log in. The `usePushNotifications` hook will
   request the OS push prompt; accept it.
2. The client POSTs the registration token to `/api/push/register`.
   Watch the server logs for `[NOTIFICATION]` or query the DB:

   ```sql
   SELECT id, "userId", platform, "isActive", "lastSeenAt"
   FROM "DeviceToken" WHERE "userId" = '<your-user-id>'
   ORDER BY "lastSeenAt" DESC;
   ```

3. Send a test push as an admin:

   ```bash
   curl -X POST https://<server>/api/admin/push/test \
     -H 'Content-Type: application/json' \
     -b 'accessToken=<admin-cookie>' \
     -d '{"userId":"<target-user-id>","title":"Hi","body":"From R2"}'
   ```

   The response is a per-token result array. If `success: false`
   appears with `errorCode: "auth-failed"`, your provider config is
   wrong. If `errorCode: "invalid-token"`, the device's token has
   been revoked (Android: app reinstall; iOS: provisioning profile
   change).

4. If a token reaches 5 consecutive failures it is auto-deactivated
   (`isActive = false`). To force a re-registration, log out and back
   in on the device.

---

## 4 — Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| iOS works, Android fails with `auth-failed` | `FCM_SERVICE_ACCOUNT_JSON` is missing or malformed JSON |
| Android works, iOS fails with `403 InvalidProviderToken` | `.p8` newlines mangled, or `APNS_KEY_ID` / `APNS_TEAM_ID` mismatch |
| Both fail with `auth-failed: not-configured` | Server is running, but no provider env vars are set — push is no-op'd |
| Tap on iOS doesn't open the right screen | Verify the push payload includes `data.journeyId` — the router uses that to deep-link |
| `pushNotificationReceived` toast doesn't appear when app is foregrounded | The hook must be mounted; check the `<PushBridge />` component is rendered inside `BrowserRouter` |
