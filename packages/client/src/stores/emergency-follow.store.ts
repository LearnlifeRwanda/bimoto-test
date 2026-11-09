import { create } from 'zustand';

// SOS-FOLLOW G3/G4 — what THIS phone knows about its own emergencies.
//
// Not to be confused with emergency-alert.store.ts, which is the ADMIN
// side: alerts arriving from the 'admins' room for the ops banner. This
// one is the participant side, and it exists because of a specific hole.
//
// Before it, the only thing that knew an emergency was live was
// `notifyState` inside EmergencySOS — component state, which does not
// survive a navigation, a backgrounded app or a restart. So the phone of
// somebody in an emergency stopped knowing it was in one the moment they
// switched screens, and a follow keyed on that would have been a follow
// that quietly stopped when it was needed most.
//
// Module-level, for the same reason the admin store is: it has to
// outlive every component that touches it. Keyed by journeyId because
// that is what a screen has, holding the alertId because that is what
// the emergency is.
//
// THREE THINGS FEED IT and their precedence is deliberate:
//
//   1. the press response (this device raised it — instant, no round
//      trip);
//   2. the journey-room EMERGENCY_ALERT event (the OTHER participant's
//      device learns it, which is how both phones stream when only one
//      pressed);
//   3. GET /journeys/:id/emergency/active on mount — the remount truth,
//      and the only one of the three that survives a restart.
//
// SERVER TRUTH OUTRANKS LOCAL STATE, in both directions. (3) returning
// null clears a stale local belief; the ended-event clears it too. This
// store never decides on its own that an emergency is over, and never
// decides on its own that one is live.
interface EmergencyFollowState {
  /** journeyId → the ACTIVE alert's id. */
  active: Record<string, string>;
  /** A press, a journey-room alert, or the active-GET saying yes. */
  markActive: (journeyId: string, alertId: string) => void;
  /** The ended-event, or the active-GET saying no. */
  clear: (journeyId: string) => void;
  alertIdFor: (journeyId: string) => string | undefined;
}

export const useEmergencyFollowStore = create<EmergencyFollowState>((set, get) => ({
  active: {},
  markActive: (journeyId, alertId) =>
    set((state) =>
      state.active[journeyId] === alertId
        ? state
        : { active: { ...state.active, [journeyId]: alertId } },
    ),
  clear: (journeyId) =>
    set((state) => {
      if (!(journeyId in state.active)) return state;
      const next = { ...state.active };
      delete next[journeyId];
      return { active: next };
    }),
  alertIdFor: (journeyId) => get().active[journeyId],
}));
