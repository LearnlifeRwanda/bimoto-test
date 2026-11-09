// CONFIG/SOS.TS
//
// QUEUE-UNITY G4 — the red button's reflexes, tunable without a code
// change.
//
// The two durations in the emergency chain used to be literals in the
// components that owned them: HOLD_MS in EmergencyButton, CANCEL_WINDOW_MS
// in EmergencySOS. Both were reviewer judgement — reasonable numbers
// chosen at a desk — and the people who can tell whether they are right
// are riding in Kigali with gloves on. Judgement calls that only the
// field can settle should not need a dispatch to revise.
//
// PRECISION ABOUT WHAT THIS BUYS. Vite inlines `import.meta.env.*` at
// BUILD time. Changing VITE_SOS_HOLD_MS means rebuilding and reshipping
// the APK; it is not a live flag and there is no remote flip. What is
// gained is that tuning stops being a code change, a review and a merge
// — it becomes a build variable. That is a real saving on the loop time
// between "the gloves are a problem" and a build that fixes it, and it
// is the whole of the saving. Anything that needs to change without a
// release needs a server-driven flag, which this is not.
//
// WHY THE HOLD DEFAULT MOVED, 700 → 1000 ms (founder decision, this
// session). When FLIGHT-RECORDER added the hold, it was the only gate
// against an accidental fire. There are three now — hold, confirm,
// cancel window — and a gate that is one of three can afford to be
// generous where a gate that is the only one cannot. 700 ms is a short
// press for a hand that is also holding a bike in the rain, and every
// false negative (a real emergency where the button "didn't work") is
// far more expensive than a false positive that the confirm dialog then
// catches. So the hold gets more margin for pockets, knees, rain and
// gloves.
//
// The cancel window stays at 3000 ms: it guards a different thing (a
// press someone thought better of) and nothing about it changed.
//
// UNCHANGED BY THIS MODULE: the confirm dialog, the recipients, the
// payload, the endpoint, and tel:112 being one tap away in every state
// including the countdown. The keyboard path is unaffected too — Enter
// and Space open the confirm directly and never wait for a hold, so no
// value here can make the button harder to reach for someone driving it
// from an assistive device.

/**
 * Read a positive-integer duration from the build environment.
 *
 * Anything missing, unparseable or non-positive falls back to the
 * default rather than throwing. A malformed env var must never be able
 * to produce an emergency button with a zero-length or NaN hold — the
 * failure mode of a safety control is "behaves as designed", not
 * "crashes loudly".
 */
function durationMs(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.round(parsed);
}

/** Default hold, in ms, when VITE_SOS_HOLD_MS is unset or unusable. */
export const SOS_HOLD_MS_DEFAULT = 1000;

/** Default cancel window, in ms, when VITE_SOS_CANCEL_MS is unusable. */
export const SOS_CANCEL_MS_DEFAULT = 3000;

/**
 * How long a deliberate press lasts. Long enough that a knee cannot
 * produce it, short enough that someone who means it does not wonder
 * whether the button is broken.
 */
export const SOS_HOLD_MS = durationMs(
  import.meta.env.VITE_SOS_HOLD_MS,
  SOS_HOLD_MS_DEFAULT,
);

/**
 * The regret window. Long enough to read the sentence and stop it,
 * short enough that someone in real trouble does not spend it wondering
 * whether anything is happening.
 */
export const SOS_CANCEL_MS = durationMs(
  import.meta.env.VITE_SOS_CANCEL_MS,
  SOS_CANCEL_MS_DEFAULT,
);

/** Exported for the tests that prove the parser's refusals. */
export const _durationMsForTests = durationMs;

// ── SOS-FOLLOW G4 — the live follow's two numbers ──────────────────
//
// Same build-time-variable idiom as the two above, and the same honest
// limit on what it buys: Vite inlines these, so changing one means a
// rebuild and a reshipped APK. What is gained is that a number the field
// can settle stops needing a code change.

/** Default gap between follow frames when VITE_EMERGENCY_FOLLOW_MS is unusable. */
export const EMERGENCY_FOLLOW_MS_DEFAULT = 5_000;

/**
 * How often a phone sends its position while its journey holds an ACTIVE
 * emergency alert.
 *
 * Five seconds, against the ordinary ride broadcast's eight. The two
 * streams answer different questions: the ride broadcast tells a waiting
 * passenger roughly where their motari is, and eight seconds is plenty.
 * This one is somebody trying to find a person, and the distance a bike
 * covers in the difference is the difference between a street and a
 * junction. It is not made much smaller than this on purpose — a phone
 * in an emergency is also a phone whose battery has to last, and a
 * one-second stream buys precision nobody is using at the cost of the
 * thing that matters more.
 */
export const EMERGENCY_FOLLOW_MS = durationMs(
  import.meta.env.VITE_EMERGENCY_FOLLOW_MS,
  EMERGENCY_FOLLOW_MS_DEFAULT,
);

/** Default local cap when VITE_EMERGENCY_FOLLOW_CAP_MS is unusable. */
export const EMERGENCY_FOLLOW_CAP_MS_DEFAULT = 60 * 60 * 1000;

/**
 * The phone's own stop, mirroring the server's 60-minute expiry valve.
 *
 * The server closes an abandoned alert and tells the journey room, and
 * that is how a follow normally ends. But the message that ends it
 * travels over the socket, and the phone most likely to still be
 * streaming an hour into an emergency is the phone that lost its socket.
 * So the device holds the same clock independently: after this long it
 * stops, whether or not anybody could tell it to.
 *
 * A cap that is shorter than the server's would cut a live follow short;
 * one that is longer would leave a phone streaming past the permission
 * that authorised it. It mirrors EMERGENCY_AUTO_EXPIRE_MIN deliberately,
 * and the two are meant to be changed together.
 */
export const EMERGENCY_FOLLOW_CAP_MS = durationMs(
  import.meta.env.VITE_EMERGENCY_FOLLOW_CAP_MS,
  EMERGENCY_FOLLOW_CAP_MS_DEFAULT,
);
