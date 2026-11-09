// In-memory cache used by authMiddleware to avoid hitting the DB on every
// request to check the caller's blocking status. The cache is invalidated
// explicitly after the transaction that changes that status commits — by
// the freeze/unfreeze service and by account erasure — so a frozen or
// erased user is always blocked on their next request even within the TTL.
//
// ACCOUNT-RIGHTS-CORE G3 — the entry carries TWO facts now, read by ONE
// query. It used to hold `frozenAt` alone, which is why a deleted account
// kept working: `isDeleted` was written by the erasure and read by
// literally nothing in the repo, so the anonymised "Deleted User" carried
// on booking rides with a live token. Adding a second lookup would have
// doubled the per-request DB cost on the hottest path in the server;
// widening the one that was already there costs nothing, because both
// columns come off the same row.
//
// ACCOUNT-RIGHTS-SURFACE G5a — and the exported names now say that.
//
// #195 widened the entry from `frozenAt` alone to {frozenAt, isDeleted}
// but kept four `...AuthFrozenCache` names, on the reasoning that renaming
// them was churn across thirty-odd files for no behavioural gain. The
// gain is not behavioural, it is that a reader of `setAuthFrozenCache(id,
// frozenAt, isDeleted)` has to already know the name is lying. That debt
// is paid here, once, mechanically: get/set/invalidate/_reset now read
// `...AuthStatusCache`, matching both the module and the AuthStatusEntry
// it stores. Every consumer moved in the same commit — direct importers,
// the four re-exports through middleware/auth.ts that most test files
// actually import from, and every jest.mock/jest.doMock object literal.
// Nothing about what the cache DOES changed.
//
// The FROZEN_USER_AUTH_CACHE_* config constants keep their names: they are
// bound to environment variables of the same name, so renaming them is a
// deployment-visible change and not this dispatch's to make.

import {
  FROZEN_USER_AUTH_CACHE_MAX_ENTRIES,
  FROZEN_USER_AUTH_CACHE_TTL_MS,
} from '../services/admin/config';

/**
 * The blocking status of one user, as auth needs to know it.
 *
 * `frozenAt` is an admin freeze — a 403 with a reason the user can appeal.
 * `isDeleted` is an executed erasure — a 401, because there is no account
 * left to explain anything to. They are separate fields rather than one
 * "blocked" boolean precisely because the two renderings differ.
 */
export interface AuthStatusEntry {
  frozenAt: Date | null;
  isDeleted: boolean;
  expiresAt: number;
}

const cache = new Map<string, AuthStatusEntry>();

function evictIfFull() {
  if (cache.size < FROZEN_USER_AUTH_CACHE_MAX_ENTRIES) return;
  // Drop the oldest insertion-order entry (Map iteration is insertion order).
  const firstKey = cache.keys().next().value;
  if (firstKey !== undefined) cache.delete(firstKey);
}

export function getAuthStatusCache(userId: string): AuthStatusEntry | null {
  const hit = cache.get(userId);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) {
    cache.delete(userId);
    return null;
  }
  return hit;
}

export function setAuthStatusCache(
  userId: string,
  frozenAt: Date | null,
  isDeleted: boolean = false,
): void {
  evictIfFull();
  cache.set(userId, {
    frozenAt,
    isDeleted,
    expiresAt: Date.now() + FROZEN_USER_AUTH_CACHE_TTL_MS,
  });
}

export function invalidateAuthStatusCache(userId: string): void {
  cache.delete(userId);
}

export function _resetAuthStatusCacheForTests(): void {
  cache.clear();
}
