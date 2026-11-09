import { create } from 'zustand';

// PREPROTO-SIM G4 — server-reported run modes, fetched once from
// GET /api/health at bootstrap. Defaults are 'live': the banner must
// only appear when the server has positively confirmed simulation, so
// an unreachable health endpoint never paints real money as fake —
// and never hides a real "no real money" warning behind a guess.
export type RunMode = 'live' | 'simulated';

interface SimulationState {
  paymentsMode: RunMode;
  smsMode: RunMode;
  // COUNTER-READY G3 — the dormant switch, read from the SAME boot-time
  // /api/health probe and defaulted the SAME fail-safe way, inverted.
  //
  // The simulation modes default to 'live' so an unreachable health
  // endpoint never paints real money as fake. This defaults to FALSE so
  // an unreachable health endpoint never ENABLES a dormant feature: with
  // no positive confirmation from the server the counter affordance
  // renders nowhere, which is exactly what a phone talking to a pilot
  // server that has not been flipped should show.
  counterBidEnabled: boolean;
  // Per-session dismissal only (never persisted): the banner returns on
  // every app start as long as the server stays in a simulated mode.
  bannerDismissed: boolean;
  setModes: (paymentsMode: RunMode, smsMode: RunMode) => void;
  setCounterBidEnabled: (enabled: boolean) => void;
  dismissBanner: () => void;
}

export const useSimulationStore = create<SimulationState>((set) => ({
  paymentsMode: 'live',
  smsMode: 'live',
  counterBidEnabled: false,
  bannerDismissed: false,
  setModes: (paymentsMode, smsMode) => set({ paymentsMode, smsMode }),
  setCounterBidEnabled: (counterBidEnabled) => set({ counterBidEnabled }),
  dismissBanner: () => set({ bannerDismissed: true }),
}));
