# Recipient SMS Notifications

R3-DELIVERY-NOTIFICATIONS introduced the first localised-SMS pipeline
for parcel-delivery recipients (non-Bimoto users). Before it, the
person whose phone the customer entered as `Leg.contactPhone` received
nothing — their only signal was the customer manually phoning them.

## Events

| Event | Triggered when | Helper |
|---|---|---|
| Driver en route | `acceptBid` succeeds on a journey with at least one goods leg (`GOODS_PICKUP` / `GOODS_DROPOFF`) carrying `contactPhone` | `notifyRecipientDriverEnRoute` |
| Parcel delivered | `markLegCompleted` succeeds on a `GOODS_DROPOFF` leg with `contactPhone` | `notifyRecipientParcelDelivered` |

Both helpers live in
`packages/server/src/services/recipient-sms-notification.service.ts`.

## Localisation

Both messages are sent in the journey customer's `User.language`
(default `rw`). The 3 supported languages — Kinyarwanda (`rw`),
English (`en`), French (`fr`) — match the `Language` enum in the
Prisma schema.

Templates are inline TypeScript switch-cases (no JSON locale-merge
risk). The recipient inherits the customer's language; per-recipient
language hints are a future extension.

## Reliability model

Both helpers are fire-and-forget: SMS failures are logged + reported
to Sentry but never block the calling flow. The recipient SMS is a
side effect of the main journey loop; the journey acceptance / leg
completion is the deliverable, not the SMS. This matches the
`journey.service.ts` and `scheduled-ride-reminder.job.ts` convention.

OTP messages use the opposite convention (`await sendSms`) because
SMS delivery *is* the deliverable for OTP — these recipient
notifications are not.

## Why a separate service file

`packages/server/src/services/notification.service.ts` targets Bimoto
users — people with an account, a session, and (eventually) a device
token. Recipient SMS targets non-Bimoto users who have no push
subscription and no account at all. Mixing the two delivery channels in
one file would conflate them. `recipient-sms-notification.service.ts`
is the single source of truth for SMS-to-recipients.

> **Updated by NOTIFY G3 (2026-08-24).** This section used to say
> `notification.service.ts` is "push-only". It is not, and saying so
> was part of how the gap below went unnoticed for so long. It now
> composes, per helper: the `console.log`, a push, and — for the six
> events a signed-in user must SEE — a socket emit to that user's own
> room. Two helpers also fall back to SMS (the verification decisions).
> The reason it matters is that push has no APNS/FCM credentials yet
> (Barack, 24 Aug), so until they land the socket leg is the ONLY leg
> that actually reaches anybody.

## Future extensions

- Multi-recipient (different `contactPhone`s on different legs of one
  journey)
- Recipient confirmation reply-flow (link with `sms-inbound`)
- Per-recipient language hint
- Driver-arrived-at-pickup SMS (proximity-triggered)
- Phone-number normalisation (E.164)
