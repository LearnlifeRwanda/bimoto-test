import {
  VehicleType,
  VEHICLE_COMPLIANCE,
  getVehicleCompliance,
  checkDriverCompliance,
} from '@bimoto/shared';

describe('Vehicle Compliance Config', () => {
  describe('VEHICLE_COMPLIANCE', () => {
    test('all 4 vehicle types have config entries', () => {
      expect(VEHICLE_COMPLIANCE[VehicleType.BIKE]).toBeDefined();
      expect(VEHICLE_COMPLIANCE[VehicleType.MOTO]).toBeDefined();
      expect(VEHICLE_COMPLIANCE[VehicleType.E_MOTO]).toBeDefined();
      expect(VEHICLE_COMPLIANCE[VehicleType.E_BIKE]).toBeDefined();
    });

    test('BIKE config has correct values', () => {
      const config = VEHICLE_COMPLIANCE[VehicleType.BIKE];
      expect(config.helmetRequired).toBe(false);
      expect(config.registrationRequired).toBe(false);
      expect(config.ruraRequired).toBe(false);
      expect(config.licenseRequired).toBe(false);
      expect(config.insuranceRequired).toBe(false);
      expect(config.cooperativeRequired).toBe(false);
      expect(config.isMotorized).toBe(false);
      expect(config.isElectric).toBe(false);
      expect(config.maxPlausibleSpeedKmh).toBe(40);
    });

    test('MOTO config has correct values', () => {
      const config = VEHICLE_COMPLIANCE[VehicleType.MOTO];
      expect(config.helmetRequired).toBe(true);
      expect(config.registrationRequired).toBe(true);
      expect(config.ruraRequired).toBe(true);
      expect(config.licenseRequired).toBe(true);
      expect(config.licenseCategory).toBe('A');
      expect(config.insuranceRequired).toBe(true);
      expect(config.cooperativeRequired).toBe(true);
      expect(config.isMotorized).toBe(true);
      expect(config.isElectric).toBe(false);
      expect(config.maxPlausibleSpeedKmh).toBe(90);
    });

    test('E_MOTO config has correct values', () => {
      const config = VEHICLE_COMPLIANCE[VehicleType.E_MOTO];
      expect(config.helmetRequired).toBe(true);
      expect(config.registrationRequired).toBe(true);
      expect(config.ruraRequired).toBe(true);
      expect(config.licenseRequired).toBe(true);
      expect(config.licenseCategory).toBe('A');
      expect(config.insuranceRequired).toBe(true);
      expect(config.cooperativeRequired).toBe(true);
      expect(config.isMotorized).toBe(true);
      expect(config.isElectric).toBe(true);
      expect(config.maxPlausibleSpeedKmh).toBe(80);
    });

    test('E_BIKE config has correct values', () => {
      const config = VEHICLE_COMPLIANCE[VehicleType.E_BIKE];
      expect(config.helmetRequired).toBe(true);
      expect(config.registrationRequired).toBe(false);
      expect(config.ruraRequired).toBe(false);
      expect(config.licenseRequired).toBe(false);
      expect(config.insuranceRequired).toBe(false);
      expect(config.cooperativeRequired).toBe(false);
      expect(config.isMotorized).toBe(true);
      expect(config.isElectric).toBe(true);
      expect(config.maxPlausibleSpeedKmh).toBe(50);
    });
  });

  describe('getVehicleCompliance', () => {
    test('returns correct config for all known types', () => {
      expect(getVehicleCompliance('BIKE').nameKey).toBe('vehicles.bike');
      expect(getVehicleCompliance('MOTO').nameKey).toBe('vehicles.moto');
      expect(getVehicleCompliance('E_MOTO').nameKey).toBe('vehicles.emoto');
      expect(getVehicleCompliance('E_BIKE').nameKey).toBe('vehicles.ebike');
    });

    test('returns MOTO config for unknown vehicle types (safest default)', () => {
      const unknown = getVehicleCompliance('UNKNOWN_TYPE');
      const moto = getVehicleCompliance('MOTO');
      expect(unknown).toEqual(moto);
    });
  });

  describe('checkDriverCompliance', () => {
    test('BIKE driver with no documents → empty missing list', () => {
      const missing = checkDriverCompliance('BIKE', {});
      expect(missing).toEqual([]);
    });

    test('E_BIKE driver with no documents → empty missing list', () => {
      const missing = checkDriverCompliance('E_BIKE', {});
      expect(missing).toEqual([]);
    });

    test('MOTO driver with no documents → 5 missing items', () => {
      const missing = checkDriverCompliance('MOTO', {});
      expect(missing).toHaveLength(5);
      expect(missing).toContain('drivingLicense');
      expect(missing).toContain('ruraAuthorization');
      expect(missing).toContain('cooperativeMembership');
      expect(missing).toContain('insurance');
      expect(missing).toContain('registrationPlate');
    });

    test('MOTO driver with all documents → empty missing list', () => {
      const missing = checkDriverCompliance('MOTO', {
        drivingLicenseNumber: 'DL-12345',
        ruraAuthorizationNumber: 'RURA-67890',
        cooperativeName: 'Kigali Moto Coop',
        insuranceConfirmed: true,
        registrationPlate: 'RAC 123A',
      });
      expect(missing).toEqual([]);
    });

    test('E_MOTO driver with no documents → 5 missing items', () => {
      const missing = checkDriverCompliance('E_MOTO', {});
      expect(missing).toHaveLength(5);
      expect(missing).toContain('drivingLicense');
      expect(missing).toContain('ruraAuthorization');
      expect(missing).toContain('cooperativeMembership');
      expect(missing).toContain('insurance');
      expect(missing).toContain('registrationPlate');
    });

    test('MOTO driver with partial documents → correct missing items', () => {
      const missing = checkDriverCompliance('MOTO', {
        drivingLicenseNumber: 'DL-12345',
        insuranceConfirmed: true,
      });
      expect(missing).toHaveLength(3);
      expect(missing).toContain('ruraAuthorization');
      expect(missing).toContain('cooperativeMembership');
      expect(missing).toContain('registrationPlate');
    });
  });
});
