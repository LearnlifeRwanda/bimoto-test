import { create } from 'zustand';

// SOCKET-FIX G2 — a journey:available socket event lands here as a
// monotonic signal. The payload carries only { journeyId, urgent? }, not
// the journey itself, so whichever driver surface is mounted (the
// dashboard job list) reacts by refetching; with no consumer mounted the
// signal is inert state, never an error.
interface JourneyAvailableSignal {
  seq: number;
  journeyId: string;
  urgent?: boolean;
}

interface JourneyState {
  journeys: any[];
  activeJourney: any | null;
  nearbyRequests: any[];
  availableSignal: JourneyAvailableSignal | null;
  isLoading: boolean;
  setJourneys: (journeys: any[]) => void;
  setActiveJourney: (journey: any | null) => void;
  setNearbyRequests: (requests: any[]) => void;
  signalJourneyAvailable: (journeyId: string, urgent?: boolean) => void;
  updateNearbyRequest: (id: string, updates: Partial<any>) => void;
  updateJourney: (id: string, updates: Partial<any>) => void;
  setLoading: (loading: boolean) => void;
}

export const useJourneyStore = create<JourneyState>((set) => ({
  journeys: [],
  activeJourney: null,
  nearbyRequests: [],
  availableSignal: null,
  isLoading: false,
  setJourneys: (journeys) => set({ journeys }),
  setActiveJourney: (activeJourney) => set({ activeJourney }),
  setNearbyRequests: (nearbyRequests) => set({ nearbyRequests }),
  signalJourneyAvailable: (journeyId, urgent) => set((state) => ({
    availableSignal: {
      seq: (state.availableSignal?.seq ?? 0) + 1,
      journeyId,
      urgent,
    },
  })),
  // SOCKET-FIX G3 — updateJourney only touches journeys/activeJourney;
  // the driver's job list is a separate slice, so live updates (wish
  // price) need this to reach the rendered cards.
  updateNearbyRequest: (id, updates) => set((state) => ({
    nearbyRequests: state.nearbyRequests.map(r => r.id === id ? { ...r, ...updates } : r),
  })),
  updateJourney: (id, updates) => set((state) => ({
    journeys: state.journeys.map(j => j.id === id ? { ...j, ...updates } : j),
    activeJourney: state.activeJourney?.id === id ? { ...state.activeJourney, ...updates } : state.activeJourney,
  })),
  setLoading: (isLoading) => set({ isLoading }),
}));
