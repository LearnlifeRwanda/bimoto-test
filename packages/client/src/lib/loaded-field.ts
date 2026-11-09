// LIB/LOADED-FIELD.TS
//
// CUTGUARD v2 G2 — "a field never loaded is never saved."
//
// THE DEFECT THIS IS THE MECHANISM FOR. Both editing screens seed their
// state once, from the user object the auth store happens to be holding:
//
//     const [contacts, setContacts] = useState(user?.emergencyContacts || []);
//
// and then save by whole-array replace. That `|| []` is the whole bug. It
// collapses two completely different facts into the same value:
//
//     "she has no emergency contacts"        → []
//     "this payload never carried the field" → []
//
// The first is a state worth saving. The second is a state worth
// REFUSING to save — and the screen could not tell them apart, so a rider
// whose login payload omitted the field (B-1) added one contact and PUT
// `[theNewOne]` over the two real numbers underneath. Her SOS fan-out
// went quiet and nothing told her.
//
// WHY THIS SHAPE AND NOT THE SMALLER ONE. G1 fixed the payload, so the
// field is present at login now. That is the fix; this is the mechanism,
// and it is deliberately not "check for undefined before saving":
//
//   - a check is a thing a person has to remember at each of the four
//     save sites, and forgetting one is invisible until a rider's
//     contacts are gone;
//   - the store is not only written by login. It is written by the boot
//     restore, by every profile refetch, and it is rehydrated from a
//     PERSISTED snapshot written by an older build of the app. A v13
//     phone that updates to v14 comes up holding a v13-shaped user. The
//     server being right from now on does not make the store right on
//     the first frame after an update.
//
// So the distinction is carried in the TYPE, and the function that builds
// a save payload cannot produce one from a field that was never loaded —
// it returns `{ ok: false }` and there is no value to send. The screen
// then does the only useful thing: fetches the field and asks again.
//
// WHY NOT DELTA OPERATIONS. That is the stronger design — with
// `POST /me/emergency-contacts` and `DELETE /me/emergency-contacts/:i`
// there is no whole-array PUT left to misuse, and the class is closed by
// construction rather than by discipline. It is not taken here because it
// requires changing a write path, and this dispatch's own condition for
// preferring it ("if the server routes allow it without a write-path
// change") is not met: `PUT /api/users/me` takes the whole array and
// `updateMe` writes the whole column. Recorded as the follow-up, with
// this module as the durable floor under it either way — the delta
// routes would still need a screen that knows whether it loaded what it
// is about to edit.

/**
 * A field that either came from a payload that actually carried it, or
 * did not. `loaded: false` is NOT "empty" — it is "no answer", and the
 * two must never be spelled the same way again.
 */
export type LoadedField<T> =
  | { readonly loaded: true; readonly value: T }
  | { readonly loaded: false };

/**
 * Read a field off a payload that may or may not have carried it.
 *
 * `null` and `undefined` both mean "not carried". A `null` from the wire
 * is the server declining to answer, which is not the same as answering
 * "none" — and for the two fields this guards, the server's way of
 * saying "none" is `[]` and `{…}` respectively, never `null`.
 */
export function loadedField<T>(raw: T | null | undefined): LoadedField<T> {
  return raw === null || raw === undefined ? { loaded: false } : { loaded: true, value: raw };
}

/**
 * The value to DRAW, with a fallback for the not-loaded case.
 *
 * Rendering is the one place the fallback is honest: a screen that has
 * not loaded the contacts yet should show an empty list, because it has
 * nothing else to show. The fallback is confined to this function so it
 * can never leak into a save — `deriveSave` below has no fallback and no
 * way to acquire one.
 */
export function forDisplay<T>(field: LoadedField<T>, whenAbsent: T): T {
  return field.loaded ? field.value : whenAbsent;
}

/**
 * THE INVARIANT, as a function: a field never loaded is never saved.
 *
 * Builds the next value of a field from its current one. When the field
 * was never loaded there is no current one, so there is no next one
 * either — the caller receives `{ ok: false }` and has nothing to put in
 * a request body. That is the point: the destructive payload is not
 * discouraged, it is unconstructible.
 *
 * `mutate` receives the loaded value and returns the replacement, which
 * keeps every add/remove edit expressed the way it already was.
 */
export function deriveSave<T>(
  field: LoadedField<T>,
  mutate: (current: T) => T,
): { ok: true; value: T } | { ok: false } {
  if (!field.loaded) return { ok: false };
  return { ok: true, value: mutate(field.value) };
}

/**
 * Fold a server response back into a loaded field.
 *
 * Used after a successful save: the response IS a payload, so it is
 * subject to the same question as any other. A server that answered
 * without the field leaves the screen not-loaded rather than pretending
 * the save proved something about it.
 */
export function fieldFromResponse<T>(raw: T | null | undefined): LoadedField<T> {
  return loadedField(raw);
}
