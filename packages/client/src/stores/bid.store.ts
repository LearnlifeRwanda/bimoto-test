import { create } from 'zustand';

interface BidState {
  bids: any[];
  myBids: any[];
  isLoading: boolean;
  setBids: (bids: any[]) => void;
  addBid: (bid: any) => void;
  removeBid: (id: string) => void;
  setMyBids: (bids: any[]) => void;
  updateBid: (id: string, updates: Partial<any>) => void;
  setLoading: (loading: boolean) => void;
}

export const useBidStore = create<BidState>((set) => ({
  bids: [],
  myBids: [],
  isLoading: false,
  setBids: (bids) => set({ bids }),
  // MATCH-CLOSE G2 — idempotent by bid id. Two independent paths now
  // insert bids on the customer's list: the BID_PLACED socket handler
  // in useSocket and the bid list's polling fallback. This is the one
  // choke point both go through, so a bid that arrives twice (socket
  // re-delivery after a reconnect, or a poll that overlaps the event)
  // is stored once. Later fields win on a repeat so a refreshed row
  // cannot be masked by a stale duplicate.
  addBid: (bid) =>
    set((state) =>
      state.bids.some((b) => b.id === bid.id)
        ? { bids: state.bids.map((b) => (b.id === bid.id ? { ...b, ...bid } : b)) }
        : { bids: [...state.bids, bid] },
    ),
  // LIVE-WIRE G2 — the other direction of addBid. A withdrawn bid must
  // leave the list the moment the socket says so; leaving it until the
  // next poll means a passenger can tap Accept on an offer that is gone
  // and be answered with a 400.
  removeBid: (id) => set((state) => ({ bids: state.bids.filter((b) => b.id !== id) })),
  setMyBids: (myBids) => set({ myBids }),
  updateBid: (id, updates) => set((state) => ({
    bids: state.bids.map(b => b.id === id ? { ...b, ...updates } : b),
  })),
  setLoading: (isLoading) => set({ isLoading }),
}));
