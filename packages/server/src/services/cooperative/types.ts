// Dispatch M — types for the cooperative leader surface. The DTOs
// here match exactly what cooperative-leader.routes.ts returns; the
// service layer in dashboard.service.ts / management.service.ts /
// dispatch.service.ts produces them. Keep this file pure types — no
// runtime imports — so it can be consumed by tests without pulling
// in the Prisma client.

export type CooperativeRole = 'COOPERATIVE_LEADER';

export interface CooperativeDashboardSummary {
  cooperativeId: string;
  name: string;
  driverCount: number;
  activeDriverCount: number;
  onlineDriverCount: number;
  todayRideCount: number;
  todayEarningsRwf: number;
  weekRideCount: number;
  monthRideCount: number;
  averageRating: number | null;
  flaggedDriverCount: number;
  periodDays: number;
}

export interface CooperativeDriverRow {
  driverId: string;
  driverProfileId: string;
  userId: string;
  name: string;
  phone: string;
  vehicleType: string;
  active: boolean;
  isOnline: boolean;
  totalRides: number;
  avgRating: number | null;
  isFlagged: boolean;
  isFrozen: boolean;
  cooperativeName: string;
  verificationStatus: string;
}

export interface CooperativeDriverDetail {
  driver: CooperativeDriverRow;
  recentJourneys: Array<{
    id: string;
    pickupName: string;
    destinationName: string;
    status: string;
    agreedPrice: number | null;
    createdAt: Date;
    confirmedAt: Date | null;
  }>;
  recentEarnings: { totalRwf: number; periodDays: number };
  amlFlags: Array<{
    id: string;
    type: string;
    severity: string;
    status: string;
    detectedAt: Date;
  }>;
}

export interface CooperativeFinancialSummary {
  cooperativeId: string;
  periodDays: number;
  totalRideRwf: number;
  totalEarningsRwf: number;
  totalCommissionRwf: number;
  perDriver: Array<{
    driverId: string;
    rideCount: number;
    earningsRwf: number;
    commissionRwf: number;
  }>;
}

export interface DispatchBidPayload {
  driverId: string;
  customerId: string;
  pickupLat: number;
  pickupLng: number;
  pickupName?: string;
  destinationLat: number;
  destinationLng: number;
  destinationName?: string;
  vehiclePreference: string;
  priceRwf?: number;
  etaMinutes?: number;
}

export interface DispatchedBidResult {
  journeyId: string;
  bidId: string;
  driverId: string;
  customerId: string;
  priceRwf: number;
  etaMinutes: number;
  notifiedDriver: boolean;
  notifiedCustomer: boolean;
}
