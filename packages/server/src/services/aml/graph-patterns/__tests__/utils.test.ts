import {
  bipartiteDensity,
  connectedComponents,
  haversineMeters,
  clusterByRadius,
  externalEdgeRatio,
  groupBy,
} from '../utils';

describe('graph-pattern utils', () => {
  describe('bipartiteDensity', () => {
    test('fully connected 3x3 = 1.0', () => {
      const A = new Set(['a1', 'a2', 'a3']);
      const B = new Set(['b1', 'b2', 'b3']);
      const edges: [string, string][] = [];
      for (const a of A) for (const b of B) edges.push([a, b]);
      expect(bipartiteDensity(edges, A, B)).toBe(1);
    });

    test('empty edges or empty side returns 0', () => {
      expect(bipartiteDensity([], new Set(['a']), new Set(['b']))).toBe(0);
      expect(bipartiteDensity([['a', 'b']], new Set(), new Set(['b']))).toBe(0);
    });

    test('partial edges scale linearly', () => {
      const A = new Set(['a1', 'a2']);
      const B = new Set(['b1', 'b2']);
      // 2 of 4 possible pairs
      expect(bipartiteDensity([['a1', 'b1'], ['a2', 'b2']], A, B)).toBe(0.5);
    });

    test('counts edges either direction (undirected)', () => {
      const A = new Set(['a']);
      const B = new Set(['b']);
      expect(bipartiteDensity([['b', 'a']], A, B)).toBe(1);
    });
  });

  describe('connectedComponents', () => {
    test('finds 2 components in {A-B, B-C, D-E}', () => {
      const comps = connectedComponents([
        ['A', 'B'],
        ['B', 'C'],
        ['D', 'E'],
      ]);
      expect(comps).toHaveLength(2);
      const sizes = comps.map((c) => c.length).sort();
      expect(sizes).toEqual([2, 3]);
    });

    test('empty graph returns no components', () => {
      expect(connectedComponents([])).toEqual([]);
    });

    test('single edge -> single 2-node component', () => {
      const comps = connectedComponents([['x', 'y']]);
      expect(comps).toHaveLength(1);
      expect(new Set(comps[0])).toEqual(new Set(['x', 'y']));
    });
  });

  describe('haversineMeters', () => {
    test('Kigali centre -> Nyabugogo (~2.5 km)', () => {
      const kigali = { lat: -1.9536, lng: 30.0606 };
      const nyabugogo = { lat: -1.9419, lng: 30.0445 };
      const d = haversineMeters(kigali, nyabugogo);
      expect(d).toBeGreaterThan(2_000);
      expect(d).toBeLessThan(3_000);
    });

    test('identity = 0', () => {
      const p = { lat: -1.9, lng: 30.0 };
      expect(haversineMeters(p, p)).toBe(0);
    });
  });

  describe('clusterByRadius', () => {
    test('5 colocated + 5 far-apart -> 6 clusters', () => {
      const close = Array.from({ length: 5 }, (_, i) => ({
        lat: -1.95 + i * 0.0001,
        lng: 30.06 + i * 0.0001,
        meta: `c${i}`,
      }));
      const far = Array.from({ length: 5 }, (_, i) => ({
        lat: -1.95 + (i + 1) * 0.05,
        lng: 30.06 + (i + 1) * 0.05,
        meta: `f${i}`,
      }));
      const clusters = clusterByRadius([...close, ...far], 100);
      expect(clusters).toHaveLength(6);
      const sizes = clusters.map((c) => c.members.length).sort();
      expect(sizes).toEqual([1, 1, 1, 1, 1, 5]);
    });

    test('centroid of co-located points lands inside the cluster', () => {
      const pts = [
        { lat: 0, lng: 0, meta: 'a' },
        { lat: 0.0001, lng: 0.0001, meta: 'b' },
      ];
      const [c] = clusterByRadius(pts, 100);
      expect(c.centroid.lat).toBeCloseTo(0.00005, 6);
      expect(c.centroid.lng).toBeCloseTo(0.00005, 6);
    });
  });

  describe('externalEdgeRatio', () => {
    test('internal {A,B} with edges {A-B, A-C, B-D} = 2/3', () => {
      const edges: [string, string][] = [
        ['A', 'B'],
        ['A', 'C'],
        ['B', 'D'],
      ];
      expect(externalEdgeRatio(edges, new Set(['A', 'B']))).toBeCloseTo(2 / 3);
    });

    test('no edges touch -> 0', () => {
      expect(externalEdgeRatio([['X', 'Y']], new Set(['A']))).toBe(0);
    });
  });

  describe('groupBy', () => {
    test('buckets rows by key', () => {
      const rows = [
        { k: 'a', v: 1 },
        { k: 'b', v: 2 },
        { k: 'a', v: 3 },
      ];
      const grouped = groupBy(rows, (r) => r.k);
      expect(grouped.get('a')).toHaveLength(2);
      expect(grouped.get('b')).toHaveLength(1);
    });
  });

  describe('determinism (snapshot)', () => {
    test('same inputs always produce same outputs', () => {
      const edges: [string, string][] = [
        ['A', 'B'],
        ['B', 'C'],
        ['D', 'E'],
      ];
      const sortNested = (cs: string[][]) =>
        cs.map((c) => [...c].sort()).sort((a, b) => a[0].localeCompare(b[0]));
      const c1 = sortNested(connectedComponents(edges));
      const c2 = sortNested(connectedComponents(edges));
      expect(c1).toEqual(c2);
    });
  });
});
