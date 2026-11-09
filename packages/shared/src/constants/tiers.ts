export enum DriverTier {
  NEW = 'NEW',
  REGULAR = 'REGULAR',
  PRO = 'PRO',
  ELITE = 'ELITE',
}

export enum CustomerTier {
  REGULAR = 'REGULAR',
  FREQUENT = 'FREQUENT',
  SUPER = 'SUPER',
  VIP = 'VIP',
}

export interface TierThreshold {
  tier: string;
  minRides: number;
  commissionRate: number;
}

export const DRIVER_TIERS: TierThreshold[] = [
  { tier: DriverTier.NEW, minRides: 0, commissionRate: 0.05 },
  { tier: DriverTier.REGULAR, minRides: 50, commissionRate: 0.035 },
  { tier: DriverTier.PRO, minRides: 200, commissionRate: 0.025 },
  { tier: DriverTier.ELITE, minRides: 500, commissionRate: 0.015 },
];

export const CUSTOMER_TIERS: TierThreshold[] = [
  { tier: CustomerTier.REGULAR, minRides: 0, commissionRate: 0.05 },
  { tier: CustomerTier.FREQUENT, minRides: 20, commissionRate: 0.035 },
  { tier: CustomerTier.SUPER, minRides: 50, commissionRate: 0.025 },
  { tier: CustomerTier.VIP, minRides: 100, commissionRate: 0.015 },
];

export function getDriverTier(totalRides: number): TierThreshold {
  return [...DRIVER_TIERS].reverse().find(t => totalRides >= t.minRides)!;
}

export function getCustomerTier(completedRides: number): TierThreshold {
  return [...CUSTOMER_TIERS].reverse().find(t => completedRides >= t.minRides)!;
}

export function calculateCommission(
  bidPrice: number,
  driverTotalRides: number,
  customerCompletedRides: number,
): {
  driverTier: TierThreshold;
  customerTier: TierThreshold;
  driverCommissionRate: number;
  customerCommissionRate: number;
  totalCommissionRate: number;
  totalCommissionAmount: number;
  driverPayout: number;
  customerSavings: number;
  driverSavings: number;
} {
  const driverTier = getDriverTier(driverTotalRides);
  const customerTier = getCustomerTier(customerCompletedRides);
  const totalRate = driverTier.commissionRate + customerTier.commissionRate;
  const totalAmount = Math.round(bidPrice * totalRate);

  // Calculate savings vs. maximum (new user) tier
  const maxDriverRate = DRIVER_TIERS[0].commissionRate;   // 0.05 (New)
  const maxCustomerRate = CUSTOMER_TIERS[0].commissionRate; // 0.05 (Regular)
  const driverSavings = Math.round(bidPrice * (maxDriverRate - driverTier.commissionRate));
  const customerSavings = Math.round(bidPrice * (maxCustomerRate - customerTier.commissionRate));

  return {
    driverTier,
    customerTier,
    driverCommissionRate: driverTier.commissionRate,
    customerCommissionRate: customerTier.commissionRate,
    totalCommissionRate: totalRate,
    totalCommissionAmount: totalAmount,
    driverPayout: bidPrice - totalAmount,
    customerSavings,
    driverSavings,
  };
}
