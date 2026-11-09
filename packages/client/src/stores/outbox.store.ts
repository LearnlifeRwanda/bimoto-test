import { create } from 'zustand';

// OUTBOX G3 — what the replay has to tell the passenger.
//
// A booking that was held and has now gone out is news, and the news
// has to reach someone who may be three screens away from where they
// made it. It must NOT reach them as a navigation: yanking somebody out
// of whatever they are doing because a background send finished is the
// opposite of the calm this whole feature is for. So the engine records
// what it sent here, and the shell offers a way through.
//
// Deliberately in-memory: this is a notification about something that
// just happened, not durable state. The durable state is the row in
// db.outbox, and the row is gone by the time this is set.

export interface OutboxSentNotice {
  journeyId: string;
  pickupName: string;
  destinationName: string;
}

interface OutboxState {
  /** The most recent held booking the engine managed to send, or null. */
  lastSent: OutboxSentNotice | null;
  noteSent: (notice: OutboxSentNotice) => void;
  clearSent: () => void;
}

export const useOutboxStore = create<OutboxState>((set) => ({
  lastSent: null,
  noteSent: (lastSent) => set({ lastSent }),
  clearSent: () => set({ lastSent: null }),
}));
