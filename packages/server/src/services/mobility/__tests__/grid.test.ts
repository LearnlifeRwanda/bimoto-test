import { snapToCell, snapToBucket, classifyPoint } from '../grid';

describe('mobility/grid — snapToCell', () => {
  const KIGALI_LAT = -1.9536;
  const KIGALI_LNG = 30.0606;

  function metersToDegLat(m: number): number {
    return m / 111_320;
  }
  function metersToDegLng(m: number, lat: number): number {
    return m / (111_320 * Math.cos((lat * Math.PI) / 180));
  }

  it('is deterministic: same lat/lng → same cellId', () => {
    const a = snapToCell(KIGALI_LAT, KIGALI_LNG, 250);
    const b = snapToCell(KIGALI_LAT, KIGALI_LNG, 250);
    expect(a.cellId).toBe(b.cellId);
  });

  it('snaps two coordinates within cellSize/2 of a fixed center to the same cellId', () => {
    const centered = snapToCell(KIGALI_LAT, KIGALI_LNG, 250);
    const offsetM = 100; // < 250 / 2
    const lat2 = centered.centerLat + metersToDegLat(offsetM);
    const lng2 = centered.centerLng + metersToDegLng(offsetM, centered.centerLat);
    const a = snapToCell(centered.centerLat, centered.centerLng, 250);
    const b = snapToCell(lat2, lng2, 250);
    expect(a.cellId).toBe(b.cellId);
  });

  it('separates two coordinates well beyond cellSize into different cellIds', () => {
    const a = snapToCell(KIGALI_LAT, KIGALI_LNG, 250);
    const farLat = KIGALI_LAT + metersToDegLat(2000);
    const farLng = KIGALI_LNG + metersToDegLng(2000, KIGALI_LAT);
    const b = snapToCell(farLat, farLng, 250);
    expect(a.cellId).not.toBe(b.cellId);
  });

  it('uses the tier in the hash so DENSE 250m and SPARSE 250m hashes differ', () => {
    const a = snapToCell(KIGALI_LAT, KIGALI_LNG, 250, 'DENSE');
    const b = snapToCell(KIGALI_LAT, KIGALI_LNG, 250, 'SPARSE');
    expect(a.cellId).not.toBe(b.cellId);
  });

  it('cellId is opaque: contains no decimal coordinate substrings', () => {
    const { cellId } = snapToCell(KIGALI_LAT, KIGALI_LNG, 250);
    expect(cellId).toMatch(/^[0-9a-f]{64}$/);
    expect(cellId).not.toMatch(/\d+\.\d+/);
  });
});

describe('mobility/grid — snapToBucket', () => {
  it('snaps 13:47:23 UTC at 30 min buckets to 13:30 / 14:00 (UTC tz)', () => {
    const ts = new Date('2026-05-05T13:47:23Z');
    const { bucketStart, bucketEnd } = snapToBucket(ts, 30, 'UTC');
    expect(bucketStart.toISOString()).toBe('2026-05-05T13:30:00.000Z');
    expect(bucketEnd.toISOString()).toBe('2026-05-05T14:00:00.000Z');
  });

  it('snaps 00:00:00 to its own bucketStart', () => {
    const ts = new Date('2026-05-05T00:00:00.000Z');
    const { bucketStart } = snapToBucket(ts, 30, 'UTC');
    expect(bucketStart.toISOString()).toBe('2026-05-05T00:00:00.000Z');
  });

  it('honours timezone: 22:30Z = 00:30 +02:00 Kigali → bucketStart 22:00Z at 60min', () => {
    const ts = new Date('2026-05-05T22:30:00Z');
    const { bucketStart, bucketEnd } = snapToBucket(ts, 60, 'Africa/Kigali');
    expect(bucketStart.toISOString()).toBe('2026-05-05T22:00:00.000Z');
    expect(bucketEnd.toISOString()).toBe('2026-05-05T23:00:00.000Z');
  });
});

describe('mobility/grid — classifyPoint', () => {
  it('uses per-tier cellSize: DENSE = 250m hex (small), SPARSE = 5km hex (large)', () => {
    const ts = new Date('2026-05-05T10:00:00Z');
    const dense = classifyPoint({ lat: -1.9536, lng: 30.0606, timestamp: ts }, 'DENSE');
    const sparse = classifyPoint({ lat: -1.9536, lng: 30.0606, timestamp: ts }, 'SPARSE');
    expect(dense.cellId).not.toBe(sparse.cellId);

    // ~1km offset: same DENSE cell? unlikely. Same SPARSE cell? yes.
    const ts2 = ts;
    const off = (m: number) => m / 111_320;
    const denseFar = classifyPoint(
      { lat: -1.9536 + off(1000), lng: 30.0606, timestamp: ts2 },
      'DENSE',
    );
    const sparseFar = classifyPoint(
      { lat: -1.9536 + off(1000), lng: 30.0606, timestamp: ts2 },
      'SPARSE',
    );
    expect(dense.cellId).not.toBe(denseFar.cellId);
    expect(sparse.cellId).toBe(sparseFar.cellId);
  });

  it('throws on an unknown tier (defence-in-depth)', () => {
    expect(() =>
      classifyPoint(
        { lat: -1.95, lng: 30.06, timestamp: new Date() },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'BOGUS' as any,
      ),
    ).toThrow();
  });
});
