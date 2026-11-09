// HOOKS/USEDRIVERAUTOBID.TS
//
// TEAM-SAID G4 — client for the driver auto-bid rules the server has
// carried, complete and unreachable, since Dispatch K2. Five of seven
// voted to build the screen and keep it off (item 12), so this hook
// talks to routes/driver-auto-bid.routes.ts exactly as it stands and
// changes nothing on the server.
//
// ─── Why AUTO_BID_PILOT_ENABLED exists ──────────────────────────────
//
// The evaluator is NOT dormant. evaluateAutoBidsForRingDrivers is
// called from services/discovery/supply-broadcast.ts and from
// urgent-broadcast.ts on every cascade ring, with no feature flag
// between them. The only reason no auto-bid has ever fired is that no
// driver has any rules — because until this screen there was no way to
// create one.
//
// So "ships inert" cannot be delegated to the server; it has to be
// true of this client. The evaluator skips a rule when enabled is
// false (evaluator.ts:53, and it only loads `where: {enabled: true}`
// at :222), and that is the whole mechanism:
//
//   - every rule this client creates is posted with enabled: false;
//   - resume-all, which would set enabled: true on every rule at once,
//     is not callable while the flag is off;
//   - pause-all is always available, because it can only ever disable.
//
// Flip AUTO_BID_PILOT_ENABLED to true and the arming paths open. That
// is the single line the pilot decision turns on, and nothing else in
// the client needs to change.

import { useCallback, useEffect, useState } from 'react';
import { apiFetch, apiErrorFromResponse } from '../lib/api';
import { presentApiError } from '../lib/api-error-presenter';

/**
 * Auto-bid is OFF for the pilot (item 12: build it, keep it off).
 * While this is false no client path can arm a rule.
 */
export const AUTO_BID_PILOT_ENABLED = false;

/**
 * Mirrors the cap the route enforces (MAX_RULES_PER_DRIVER, and the
 * priority range [0, MAX-1] that makes it a hard ceiling on rules and
 * not merely on enabled ones). Kept as a client constant because the
 * server exposes no config endpoint; the UI blocks at the same number
 * the route would reject at.
 */
export const MAX_AUTO_BID_RULES = 5;

export type BidAmountMode = 'FLAT' | 'PERCENT_OF_FAIR_PRICE';

/** The route's vehicleTypeFilter enum, verbatim. DEADWOOD G4 replaced
 *  the old 'EMOTO' spelling with the shared VehicleType enum's
 *  'E_MOTO'; the route still accepts 'EMOTO' from a deployed APK and
 *  normalises it, but nothing here sends it any more. FLIGHT-RECORDER
 *  G5.4 added 'E_BIKE', the fourth VehicleType, which this filter had
 *  never offered. */
export type AutoBidVehicleFilter = 'MOTO' | 'BIKE' | 'E_MOTO' | 'E_BIKE' | null;

/** Exactly the shape POST /api/driver/auto-bid-rules validates. */
export interface AutoBidRuleInput {
  priority: number;
  enabled: boolean;
  maxPickupDistanceM: number;
  maxRideDistanceM: number;
  vehicleTypeFilter: AutoBidVehicleFilter;
  bidAmountMode: BidAmountMode;
  bidAmountValue: number;
}

export interface AutoBidRule extends AutoBidRuleInput {
  id: string;
  driverId: string;
  createdAt: string;
  updatedAt: string;
}

export function useDriverAutoBid() {
  const [rules, setRules] = useState<AutoBidRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/driver/auto-bid-rules', { credentials: 'include' });
      if (!res.ok) throw await apiErrorFromResponse(res);
      setRules(await res.json());
    } catch (err) {
      presentApiError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * The lowest unused priority. The route rejects a duplicate with
   * PRIORITY_TAKEN and rejects anything outside [0, MAX-1], so picking
   * the slot here is what keeps the driver from meeting either error.
   * Returns null when every slot is taken — the cap, reached.
   */
  const nextFreePriority = useCallback((): number | null => {
    const taken = new Set(rules.map((r) => r.priority));
    for (let p = 0; p < MAX_AUTO_BID_RULES; p++) {
      if (!taken.has(p)) return p;
    }
    return null;
  }, [rules]);

  const createRule = useCallback(
    async (
      input: Omit<AutoBidRuleInput, 'priority' | 'enabled'>,
    ): Promise<AutoBidRule | null> => {
      const priority = nextFreePriority();
      if (priority === null) return null;
      setBusy(true);
      try {
        const res = await apiFetch('/api/driver/auto-bid-rules', {
          method: 'POST',
          credentials: 'include',
          body: JSON.stringify({
            ...input,
            priority,
            // The inert guarantee, in one place. A rule created during
            // the pilot is stored for later and is skipped by the
            // evaluator until someone turns auto-bid on.
            enabled: AUTO_BID_PILOT_ENABLED,
          } satisfies AutoBidRuleInput),
        });
        if (!res.ok) throw await apiErrorFromResponse(res);
        const created = await res.json();
        await refresh();
        return created;
      } catch (err) {
        presentApiError(err);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [nextFreePriority, refresh],
  );

  const deleteRule = useCallback(
    async (id: string): Promise<boolean> => {
      setBusy(true);
      try {
        const res = await apiFetch(`/api/driver/auto-bid-rules/${id}`, {
          method: 'DELETE',
          credentials: 'include',
        });
        if (!res.ok) throw await apiErrorFromResponse(res);
        await refresh();
        return true;
      } catch (err) {
        presentApiError(err);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  /** Always available: pausing can only ever make auto-bid quieter. */
  const pauseAll = useCallback(async (): Promise<number | null> => {
    setBusy(true);
    try {
      const res = await apiFetch('/api/driver/auto-bid-rules/pause-all', {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw await apiErrorFromResponse(res);
      const { paused } = await res.json();
      await refresh();
      return paused;
    } catch (err) {
      presentApiError(err);
      return null;
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  /**
   * Arms every rule the driver has. Refuses to call the server while
   * auto-bid is off for the pilot — this is the one client path that
   * could start real bidding, so it is closed rather than merely
   * hidden.
   */
  const resumeAll = useCallback(async (): Promise<number | null> => {
    if (!AUTO_BID_PILOT_ENABLED) return null;
    setBusy(true);
    try {
      const res = await apiFetch('/api/driver/auto-bid-rules/resume-all', {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw await apiErrorFromResponse(res);
      const { resumed } = await res.json();
      await refresh();
      return resumed;
    } catch (err) {
      presentApiError(err);
      return null;
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  return {
    rules,
    loading,
    busy,
    refresh,
    createRule,
    deleteRule,
    pauseAll,
    resumeAll,
    nextFreePriority,
    atCap: rules.length >= MAX_AUTO_BID_RULES,
  };
}
