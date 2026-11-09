import { create } from 'zustand';

// MATCH-CLOSE G4 — the facts the diagnostics screen reports.
//
// Kigali's field reports have twice been a sentence ("position not
// received", "neither side can find the other") with no way to tell
// which hop failed. These are the hops, recorded as they happen by the
// code that performs them, so one screenshot answers the question.
//
// Deliberately NOT here: tokens, phone numbers, or any coordinate the
// app does not already send to the server. The last location is the
// one just written by PUT /api/users/me/location — showing it reveals
// nothing the server was not already told.

export interface DiagnosticsState {
  /** Last driver-feed request: the viewAs it sent, its status, when. */
  lastFeedViewAs: string | null;
  lastFeedStatus: number | null;
  lastFeedAt: number | null;
  /** Last position written to the server, and when. */
  lastLocationLat: number | null;
  lastLocationLng: number | null;
  lastLocationAt: number | null;
  /** Live socket state, as useSocket sees it. */
  socketConnected: boolean;
  /**
   * LIVE-WIRE G2 — which transport the live connection actually holds:
   * 'websocket', 'polling', or null when there is no connection.
   *
   * socket.io starts on long-polling and upgrades when it can. A phone
   * on a network that blocks websockets stays on polling silently and
   * forever — it works, but it is a degraded state we could not see
   * from Kigali, because `socketConnected` reads true either way.
   */
  socketTransport: string | null;

  recordFeedRequest: (viewAs: string, status: number) => void;
  recordLocationSent: (lat: number, lng: number) => void;
  setSocketConnected: (connected: boolean) => void;
  setSocketTransport: (transport: string | null) => void;
}

export const useDiagnosticsStore = create<DiagnosticsState>((set) => ({
  lastFeedViewAs: null,
  lastFeedStatus: null,
  lastFeedAt: null,
  lastLocationLat: null,
  lastLocationLng: null,
  lastLocationAt: null,
  socketConnected: false,
  socketTransport: null,

  recordFeedRequest: (viewAs, status) =>
    set({ lastFeedViewAs: viewAs, lastFeedStatus: status, lastFeedAt: Date.now() }),
  recordLocationSent: (lat, lng) =>
    set({ lastLocationLat: lat, lastLocationLng: lng, lastLocationAt: Date.now() }),
  setSocketConnected: (socketConnected) => set({ socketConnected }),
  setSocketTransport: (socketTransport) => set({ socketTransport }),
}));
