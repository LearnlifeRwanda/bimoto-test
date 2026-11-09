# The money PIN, and the optional app lock

Founder ruling D25 (24 August 2026). Standing constraint D26: **this
project is completely free from biometrics — no biometric API, app or
server, ever.**

## The threat

Not a thief. Not a hacker. The ordinary, constant fact of the pilot:

> A motari hands his phone to a cousin to make a call, to a passenger to
> type an address, to a friend who wants to see the app.

Almost everything in Bimoto is fine to hand over that way. Two things are
not: **what he has earned**, and **where his money goes**. Those are the
only two things the PIN stands in front of.

This is a *borrowed phone* threat model, and it has an unusual property
that shapes every decision below: **the adversary has the handset, so the
adversary also has the SMS.** Any defence that proves identity by sending
a text to that phone proves nothing at all against the person we are
actually worried about.

## Where the friction is, and where it is not

The PIN is asked at four routes and nowhere else:

| Route | Why |
|---|---|
| `GET /api/payout/summary` | shows the balance |
| `POST /api/payout/end-shift` | moves money |
| `POST /api/payout/preference` | changes where money goes |
| `POST /api/payout/preference/request-otp` | the legacy OTP arm of the same change |

A day of riding, bidding, chatting, navigating and completing journeys
never sees a PIN pad. That is the ruling, not an oversight: friction
exactly where a mistake is expensive, zero everywhere else. A PIN asked
too often is a PIN people choose to be `0000`.

Note the last row. Gating the *change* while leaving the *OTP request*
open would have been the bypass: request a code on the borrowed phone,
read the SMS on that same phone.

### Not gated, deliberately

`GET /api/driver/stats` carries `weeklyEarningsRwf`. It is the driver's
working dashboard, opened dozens of times a day, and putting a PIN in
front of it would contradict the ruling's own second half. The app lock
is the tool for whole-phone privacy. **Flagged for the gate** — if the
team wants earnings behind the PIN too, that is a one-line change and a
conversation about friction, not a technical problem.

## Enrolment is lazy

Nobody is asked to set a PIN at signup, at onboarding, or on any screen
that is not about money. The first money surface a driver opens returns
`428 MONEY_PIN_ENROLLMENT_REQUIRED`, and the client blocks that surface
until he sets one. Once.

The block has a "not now" that closes the money screen rather than
letting the balance through. It can be a real answer instead of a trap
precisely because the rest of the app stays open — a driver who taps it
goes back to riding.

### "That surface" means the surface, not the screen

This sentence is load-bearing and it has been got wrong once, so it is
written down.

The prompt renders **inside the money component that asked for it** — in
the earnings card's own box, in the payout-preference section's own slot.
It is a region of the page. It is not an overlay, it is not `fixed`, it
has no backdrop, and it does not claim `role="dialog"` or `aria-modal`,
because telling a screen reader it is a modal would be the same lie a
full-screen panel tells the eye.

The first version of this feature mounted one prompt at the app root as a
full-screen overlay. `DriverEarningsCard` sits on the driver **Dashboard**
and fetches the balance on mount, so a driver who had never set a PIN got
that overlay across his whole working screen — the feed, the online
toggle, the auto-bid entry, every navigation. Playwright's words for it
were "subtree intercepts pointer events". Every unit test passed, because
each rendered the prompt in isolation and none mounted it beside the
screen it was covering.

The rule, then: **the lazy block means "you cannot see the NUMBER until
you set a PIN", never "you cannot work."** A motari who declines can still
go online, take requests, write auto-bid rules and navigate anywhere that
is not money. `money-pin-no-block.test.tsx` — "D25 — no PIN, full working
screen" — mounts the real Dashboard against a real 428 and holds him to
that.

A corollary, since two money sections can share one page: the store holds
**one** prompt, owned by whichever call was refused first, and a second
refusal queues behind it rather than being turned away. One pad, and both
sections fill once it is answered.

## Why a reset takes a day

This is the part worth reading twice.

A driver who forgets his PIN proves himself by SMS OTP. But *whoever
holds the phone holds the SMS.* If an SMS-proven reset took effect
immediately, the borrower's path would be: open Settings, tap "I forgot
my PIN", read the code off the same handset, choose `1111`, and the PIN
would have protected nothing whatsoever.

So an SMS-proven reset does not take effect now. It takes effect **24
hours from now**, and **a text message goes out at the moment it is
requested** saying so and naming the deadline.

That message is sent at *request* time, not at activation time, and the
distinction is the entire security value: a warning that arrives when the
new PIN starts working arrives too late to be acted on.

**The old PIN keeps working for the whole window.** Using it *cancels*
the pending reset, and sends a second message saying it was cancelled.
Knowledge of the PIN beats possession of the handset. The owner wins.

The notice deliberately ignores `User.smsOptOut`. That flag is set by
texting STOP to the Bimoto number — which anyone holding the handset can
do — so honouring it would make the attack "text STOP, then reset the
PIN, and the owner is never told". STOP silences service chatter, not
the one message that says someone is moving on your money.

### The state machine

```
NOT_SET ──set──▶ SET
                  │
                  ├─ reset proven by SMS ──▶ PENDING_RESET
                  │                            │
                  │        old PIN used ◀──────┤ (cancels; notifies)
                  │                            │
                  └───────────── 24h elapsed, next verify ──▶ SET (new PIN live)
```

No job runs any of this. The pending reset is a hash plus an instant,
evaluated at verify time — the only moment it can matter. A server
switched off for the whole window behaves identically to one that was up.

### Change is not reset

Changing the PIN from Settings asks for the **current** PIN and applies
the new one **immediately**. No delay. The 24-hour wait exists solely to
cover a reset proven by *possession* of the handset; knowledge of the
live PIN is strictly stronger proof, and making the owner wait a day for
his own deliberate change would be friction that buys nothing.

## Storage

Exactly the `OtpCode` posture established by PREPROTO-AUTH G1, reusing
that module's own primitives rather than forking crypto:

- only `hmacOtp(pin)` is ever at rest — HMAC, not a bare hash, because a
  4-digit PIN has 10⁴ states and an unkeyed digest of a leaked table is
  reversible by enumeration in milliseconds;
- comparison is constant-time;
- wrong guesses are **counted**, not merely rate-limited. Five wrong
  guesses lock the PIN for fifteen minutes, and a live lockout refuses
  even the correct PIN. A rate limit only slows a guesser down; a
  terminating budget is the only thing that actually bounds one.

The plaintext PIN exists in the user's head and in one TLS request body.
It is never logged, never stored on the device, and never held in client
state beyond the moment it is posted.

## The step-up session

Proving the PIN opens a server-side session (five minutes) keyed by user
id. It lives on the server, not in a token and not on the device, because
a client-held "I verified" flag is a flag the holder of the phone can
set. The client caches only the knowledge that its last verify succeeded
— enough to avoid prompting twice, not enough to manufacture a session.

The session is **dropped**, not merely expired, on logout and on any PIN
change: a session proven by a PIN that no longer exists is not a session.

### The PIN replaced the OTP on the preference change

Ruling D25. Two reasons, and the first is the security one: this flow's
whole job is to stop someone else moving where a driver's money goes, and
an SMS step-up is proven by the phone the attacker is holding. A PIN is
proven by something he does not have. The second is that every one of
those messages costs money on a flow a driver uses perhaps twice a year.

The audit row now records which proof was actually given
(`stepUpMethod: 'PIN' | 'OTP'`). `otpVerified` is kept and stays bound to
the OTP arm, so every row written before this change keeps meaning
exactly what it meant. The MONEY-ATOMIC G4 transaction is untouched: a
failing audit-row write still rolls the preference change back.

## The app lock (optional, different, device-local)

|  | money PIN | app lock |
|---|---|---|
| where it lives | server | **device only** |
| who must have it | drivers | **nobody — default off** |
| length | 4 digits | **6+ digits** |
| what it covers | money surfaces | **every route** |
| recovery | SMS OTP + 24h | **log out, log back in** |

It is never sent to any server in any form — no endpoint, no field, no
sync — which is what lets it work **offline**. A motari with no signal
must still be able to open his own phone.

**The format separation is forced, not checked.** The money PIN is never
on the device, so the app-lock setup screen *cannot* compare a candidate
against it. It rejects by shape instead: 4-digit codes refused, 6+
required, which makes a code equal to the money PIN impossible to enter
by construction. The helper text says so before the rule is broken.

**Every route yields.** The lock renders *instead of* the route table, so
a deep link or a notification tap sets the URL but mounts nothing. A
route added tomorrow is covered, because coverage is not a list. Unlock
restores only home — the screen that was open when the phone changed
hands is not reopened.

### The emergency exception

- **`tel:112` always.** Zero auth, zero data, no journey, no network,
  rendered first and above the pad. It is a plain link the OS dials.
- **In-app SOS when a ride is live**, because the alert is journey-scoped
  and there is nothing to raise without one.

And the invariant that makes the pierce safe: **no action taken from the
lock screen changes what is reachable behind it.** There is no partial
unlock and no emergency mode. The store exposes no bypass function —
raising SOS posts to the server and the lock stays exactly where it is. A
function that does not exist cannot be called by mistake in six months.

The lock screen also carries a **log out** button, because D25's recovery
path is "log out, then log in with an SMS code" and logout otherwise
lives in Settings — behind the lock. It does not weaken the invariant:
logging out makes strictly *less* reachable, not more.

There is no other recovery. No custom reset, no support override, no
backdoor. A device-local secret with a remote recovery path is not a
device-local secret, and every backdoor built for a forgetful owner is a
backdoor for the person holding his phone.

## D26 — no biometrics

Asserted mechanically, not left to review: a test sweeps every client
source file for biometric APIs (plugin names, WebAuthn, face/touch
authentication) and fails on any of them, and checks that no biometric
dependency is installed.

The money PIN and the app lock are both places where "just add a
fingerprint unlock" is the obvious next suggestion. This is what makes
that suggestion fail loudly instead of shipping.
