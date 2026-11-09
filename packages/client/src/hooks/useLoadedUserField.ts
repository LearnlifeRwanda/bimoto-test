// HOOKS/USELOADEDUSERFIELD.TS
//
// CUTGUARD v2 G2 — the one place the "never loaded is never saved"
// invariant is wired to a screen, so the two editing screens cannot
// disagree about it and a third cannot be written without it.
//
// It does three things, and each of them exists because doing it by hand
// at four save sites is how the class stays open:
//
//   1. holds the field as a LoadedField, so "absent" and "empty" stop
//      being the same value;
//   2. RE-SEEDS from the store when the store learns the field. The seed
//      used to be a `useState` initialiser, which runs once — so a screen
//      mounted before the boot `/me` landed kept the not-loaded value for
//      its whole life, and the refetch that would have fixed it changed
//      nothing. This is the half of the defect that survives a correct
//      server;
//   3. SELF-HEALS: `ensureLoaded()` fetches `/api/users/me` and folds the
//      answer back in, so a screen that refuses a save can do something
//      about it in the same tap rather than just saying no.
//
// The refusal itself lives in `deriveSave` (lib/loaded-field.ts) — this
// hook never provides a fallback for a save, only for a render.

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { useAuthStore, type User } from '../stores/auth.store';
import {
  loadedField,
  type LoadedField,
} from '../lib/loaded-field';

/**
 * Reads one field off the stored user, keeping the "was it carried?"
 * question answerable.
 *
 * `select` runs against the store's user AND against a freshly fetched
 * `/me`, so both answers go through the same reading. It must return
 * `undefined` for "not carried" — returning a fallback here would put
 * the `|| []` back.
 */
export function useLoadedUserField<T>(
  select: (user: User | null) => T | null | undefined,
): {
  field: LoadedField<T>;
  setField: (next: LoadedField<T>) => void;
  ensureLoaded: () => Promise<LoadedField<T>>;
} {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const [field, setField] = useState<LoadedField<T>>(() => loadedField(select(user)));

  // Re-seed when the store learns the field. Deliberately one-directional:
  // it only ever moves not-loaded → loaded, so a local edit made before a
  // refetch lands is never overwritten by a staler store value.
  useEffect(() => {
    if (field.loaded) return;
    const fromStore = loadedField(select(user));
    if (fromStore.loaded) setField(fromStore);
    // `select` is a caller-supplied closure; depending on it would
    // re-run this on every render. The store user is the real input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, field.loaded]);

  const ensureLoaded = useCallback(async (): Promise<LoadedField<T>> => {
    const current = loadedField(select(useAuthStore.getState().user));
    if (current.loaded) {
      setField(current);
      return current;
    }
    try {
      const res = await apiFetch('/api/users/me');
      if (!res.ok) return { loaded: false };
      const fresh = (await res.json()) as User;
      setUser(fresh);
      const next = loadedField(select(fresh));
      setField(next);
      return next;
    } catch {
      // Offline, or the server could not answer. Not loaded is the
      // honest result, and the caller's refusal stands — which is the
      // safe direction: a save that cannot prove what it is replacing
      // does not happen.
      return { loaded: false };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setUser]);

  return { field, setField, ensureLoaded };
}
