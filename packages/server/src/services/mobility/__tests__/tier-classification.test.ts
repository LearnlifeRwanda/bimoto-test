import {
  tierForCoordinates,
  reloadTierClassification,
  getTierClassificationVersion,
  _setTierConfig,
  _resetTierConfigForTests,
} from '../tier-classification';
import type { TierClassificationFile } from '../types';

afterEach(() => {
  _resetTierConfigForTests();
});

describe('tier-classification', () => {
  it('classifies Kigali centre as DENSE', () => {
    expect(tierForCoordinates(-1.95, 30.06)).toBe('DENSE');
  });

  it('classifies Huye as MEDIUM', () => {
    expect(tierForCoordinates(-2.6, 29.74)).toBe('MEDIUM');
  });

  it('classifies Nyanza as LOW', () => {
    expect(tierForCoordinates(-2.345, 29.745)).toBe('LOW');
  });

  it('falls through to SPARSE for an unmatched rural coordinate', () => {
    // Far from any defined bounding box.
    expect(tierForCoordinates(-2.2, 30.5)).toBe('SPARSE');
  });

  it('classifies the exact bounding-box edge as inside (inclusive)', () => {
    // Kigali box edge: minLat = -2.04
    expect(tierForCoordinates(-2.04, 30.1)).toBe('DENSE');
    // Kigali box edge: maxLng = 30.20
    expect(tierForCoordinates(-1.95, 30.2)).toBe('DENSE');
  });

  it('reloadTierClassification picks up an in-memory update', () => {
    const v1 = getTierClassificationVersion();
    expect(typeof v1).toBe('string');
    const synthetic: TierClassificationFile = {
      version: '99.9-test',
      tiers: {
        DENSE: { criteria: 'test', boundingBoxes: [] },
        MEDIUM: { criteria: 'test', boundingBoxes: [] },
        LOW: { criteria: 'test', boundingBoxes: [] },
        SPARSE: { criteria: 'default', boundingBoxes: [] },
      },
    };
    _setTierConfig(synthetic);
    expect(getTierClassificationVersion()).toBe('99.9-test');
    expect(tierForCoordinates(-1.95, 30.06)).toBe('SPARSE');
    _resetTierConfigForTests();
    const reloaded = reloadTierClassification();
    expect(reloaded.version).not.toBe('99.9-test');
    expect(tierForCoordinates(-1.95, 30.06)).toBe('DENSE');
  });

  it('_setTierConfig: forced config takes effect immediately', () => {
    const synthetic: TierClassificationFile = {
      version: 'forced',
      tiers: {
        DENSE: {
          criteria: 'test',
          boundingBoxes: [
            { name: 'X', minLat: 0, maxLat: 1, minLng: 0, maxLng: 1 },
          ],
        },
        MEDIUM: { criteria: 'test', boundingBoxes: [] },
        LOW: { criteria: 'test', boundingBoxes: [] },
        SPARSE: { criteria: 'default', boundingBoxes: [] },
      },
    };
    _setTierConfig(synthetic);
    expect(tierForCoordinates(0.5, 0.5)).toBe('DENSE');
    expect(tierForCoordinates(2, 2)).toBe('SPARSE');
  });

  it('priority: DENSE matches before MEDIUM if regions overlap', () => {
    const synthetic: TierClassificationFile = {
      version: 'priority',
      tiers: {
        DENSE: {
          criteria: 'test',
          boundingBoxes: [
            { name: 'D', minLat: 0, maxLat: 10, minLng: 0, maxLng: 10 },
          ],
        },
        MEDIUM: {
          criteria: 'test',
          boundingBoxes: [
            { name: 'M', minLat: 0, maxLat: 10, minLng: 0, maxLng: 10 },
          ],
        },
        LOW: { criteria: 'test', boundingBoxes: [] },
        SPARSE: { criteria: 'default', boundingBoxes: [] },
      },
    };
    _setTierConfig(synthetic);
    expect(tierForCoordinates(5, 5)).toBe('DENSE');
  });
});
