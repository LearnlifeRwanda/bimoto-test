import { VehicleType } from './user.js';

export enum BidStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  DECLINED = 'DECLINED',
  WITHDRAWN = 'WITHDRAWN',
  EXPIRED = 'EXPIRED',
}

export enum BidAction {
  ACCEPT = 'ACCEPT',
  DECLINE = 'DECLINE',
  WITHDRAW = 'WITHDRAW',
  EXPIRE = 'EXPIRE',
  /**
   * SETTLE-UP follow-up — a machine put the journey back on the market
   * (the webhook or the unpaid-match reaper released a failed match),
   * so the bids it closed become live offers again. Driver-initiated
   * and customer-initiated states (WITHDRAWN, EXPIRED) are NOT reopened
   * by it: those were the bidder's own decision or the clock's, and a
   * release does not undo either.
   */
  REOPEN = 'REOPEN',
}

export interface Bid {
  id: string;
  journeyId: string;
  driverId: string;
  price: number;
  etaMinutes: number;
  status: BidStatus;
  createdAt: string;
  updatedAt: string;
}

export interface BidWithDriver extends Bid {
  driver: {
    nickname: string;
    avgRating: number;
    totalRides: number;
    vehicleType: VehicleType;
    vehicleDescription: string;
    registrationPlate?: string;
  };
}
