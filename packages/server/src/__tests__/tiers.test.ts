import {
  calculateCommission,
  getDriverTier,
  getCustomerTier,
  DriverTier,
  CustomerTier,
  DRIVER_TIERS,
  CUSTOMER_TIERS,
} from '@bimoto/shared';

describe('Tiered Commission System', () => {
  describe('getDriverTier', () => {
    test('returns NEW for 0 rides', () => {
      expect(getDriverTier(0).tier).toBe(DriverTier.NEW);
    });
    test('returns NEW for 49 rides', () => {
      expect(getDriverTier(49).tier).toBe(DriverTier.NEW);
    });
    test('returns REGULAR for 50 rides', () => {
      expect(getDriverTier(50).tier).toBe(DriverTier.REGULAR);
    });
    test('returns PRO for 200 rides', () => {
      expect(getDriverTier(200).tier).toBe(DriverTier.PRO);
    });
    test('returns ELITE for 500 rides', () => {
      expect(getDriverTier(500).tier).toBe(DriverTier.ELITE);
    });
    test('returns ELITE for 1000 rides', () => {
      expect(getDriverTier(1000).tier).toBe(DriverTier.ELITE);
    });
  });

  describe('getCustomerTier', () => {
    test('returns REGULAR for 0 rides', () => {
      expect(getCustomerTier(0).tier).toBe(CustomerTier.REGULAR);
    });
    test('returns FREQUENT for 20 rides', () => {
      expect(getCustomerTier(20).tier).toBe(CustomerTier.FREQUENT);
    });
    test('returns SUPER for 50 rides', () => {
      expect(getCustomerTier(50).tier).toBe(CustomerTier.SUPER);
    });
    test('returns VIP for 100 rides', () => {
      expect(getCustomerTier(100).tier).toBe(CustomerTier.VIP);
    });
  });

  describe('calculateCommission - all 16 combinations', () => {
    const bidPrice = 2000;
    const driverRides = [0, 50, 200, 500];
    const customerRides = [0, 20, 50, 100];

    for (const dr of driverRides) {
      for (const cr of customerRides) {
        const driverTier = getDriverTier(dr);
        const customerTier = getCustomerTier(cr);
        const expectedRate = driverTier.commissionRate + customerTier.commissionRate;
        const expectedAmount = Math.round(bidPrice * expectedRate);

        test(`driver ${driverTier.tier} (${dr} rides) + customer ${customerTier.tier} (${cr} rides)`, () => {
          const result = calculateCommission(bidPrice, dr, cr);
          expect(result.driverTier.tier).toBe(driverTier.tier);
          expect(result.customerTier.tier).toBe(customerTier.tier);
          expect(result.totalCommissionRate).toBeCloseTo(expectedRate, 10);
          expect(result.totalCommissionAmount).toBe(expectedAmount);
          expect(result.driverPayout).toBe(bidPrice - expectedAmount);
          expect(result.totalCommissionRate).toBeGreaterThanOrEqual(0.03);
          expect(result.totalCommissionRate).toBeLessThanOrEqual(0.10);
        });
      }
    }

    test('minimum commission is 3% (Elite + VIP)', () => {
      const result = calculateCommission(2000, 500, 100);
      expect(result.totalCommissionRate).toBe(0.03);
      expect(result.totalCommissionAmount).toBe(60);
    });

    test('maximum commission is 10% (New + Regular)', () => {
      const result = calculateCommission(2000, 0, 0);
      expect(result.totalCommissionRate).toBe(0.10);
      expect(result.totalCommissionAmount).toBe(200);
    });
  });
});
