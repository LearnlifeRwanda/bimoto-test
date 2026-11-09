// Pure graph + geometry helpers shared across graph-pattern detectors.
// All functions are deterministic — same input -> same output. No I/O.

export type Edge = readonly [string, string];

export function groupBy<T, K extends string>(
  rows: T[],
  keyFn: (t: T) => K,
): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const row of rows) {
    const key = keyFn(row);
    const bucket = out.get(key);
    if (bucket) bucket.push(row);
    else out.set(key, [row]);
  }
  return out;
}

/**
 * Bipartite density in [0, 1]: fraction of possible (sideA × sideB) pairs that
 * are actually connected by at least one edge. 1.0 = every node on side A
 * touches every node on side B.
 */
export function bipartiteDensity(
  edges: ReadonlyArray<Edge>,
  sideA: ReadonlySet<string>,
  sideB: ReadonlySet<string>,
): number {
  if (sideA.size === 0 || sideB.size === 0) return 0;
  const seen = new Set<string>();
  for (const [u, v] of edges) {
    const inAB = sideA.has(u) && sideB.has(v);
    const inBA = sideA.has(v) && sideB.has(u);
    if (inAB) seen.add(`${u}|${v}`);
    if (inBA) seen.add(`${v}|${u}`);
  }
  const possible = sideA.size * sideB.size;
  return seen.size / possible;
}

/** Connected components in an undirected graph. Returns nodeId arrays. */
export function connectedComponents(edges: ReadonlyArray<Edge>): string[][] {
  const adj = new Map<string, Set<string>>();
  const touch = (n: string) => {
    if (!adj.has(n)) adj.set(n, new Set());
  };
  for (const [u, v] of edges) {
    touch(u);
    touch(v);
    adj.get(u)!.add(v);
    adj.get(v)!.add(u);
  }
  const visited = new Set<string>();
  const components: string[][] = [];
  for (const node of adj.keys()) {
    if (visited.has(node)) continue;
    const queue = [node];
    const component: string[] = [];
    visited.add(node);
    while (queue.length > 0) {
      const cur = queue.shift()!;
      component.push(cur);
      for (const nb of adj.get(cur) ?? []) {
        if (!visited.has(nb)) {
          visited.add(nb);
          queue.push(nb);
        }
      }
    }
    components.push(component);
  }
  return components;
}

/** Great-circle distance between two lat/lng pairs, in meters. */
export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export interface ClusterPoint<T> {
  lat: number;
  lng: number;
  meta: T;
}

export interface Cluster<T> {
  centroid: { lat: number; lng: number };
  members: T[];
}

/**
 * Single-link agglomerative clustering with a fixed-radius cutoff. Two points
 * fall in the same cluster iff there is a chain of points between them where
 * each consecutive pair is within `radiusM`. Suitable for the pilot scale —
 * O(n²) in the number of points, but n is bounded by the per-window query.
 */
export function clusterByRadius<T>(
  points: ReadonlyArray<ClusterPoint<T>>,
  radiusM: number,
): Cluster<T>[] {
  const n = points.length;
  const parent = new Array(n).fill(0).map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (haversineMeters(points[i], points[j]) <= radiusM) union(i, j);
    }
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const bucket = groups.get(root);
    if (bucket) bucket.push(i);
    else groups.set(root, [i]);
  }
  const clusters: Cluster<T>[] = [];
  for (const indices of groups.values()) {
    const members = indices.map((i) => points[i].meta);
    const lat = indices.reduce((s, i) => s + points[i].lat, 0) / indices.length;
    const lng = indices.reduce((s, i) => s + points[i].lng, 0) / indices.length;
    clusters.push({ centroid: { lat, lng }, members });
  }
  return clusters;
}

/**
 * Of all edges that touch the internal-node set, what fraction have an
 * endpoint OUTSIDE the set? 0 = a fully-closed clique; 1 = no internal edges.
 */
export function externalEdgeRatio(
  allEdges: ReadonlyArray<Edge>,
  internalNodes: ReadonlySet<string>,
): number {
  let touching = 0;
  let external = 0;
  for (const [u, v] of allEdges) {
    const uIn = internalNodes.has(u);
    const vIn = internalNodes.has(v);
    if (!uIn && !vIn) continue;
    touching += 1;
    if (!(uIn && vIn)) external += 1;
  }
  if (touching === 0) return 0;
  return external / touching;
}
