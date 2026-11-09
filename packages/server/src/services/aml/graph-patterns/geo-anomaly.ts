import type { PrismaClient } from '@prisma/client';
import { clusterByRadius, type ClusterPoint } from './utils';
import {
  GEO_ANOMALY_CLUSTER_RADIUS_M,
  GEO_ANOMALY_MIN_DISTINCT_CUSTOMERS,
  GEO_ANOMALY_MIN_RIDES_PER_WEEK,
  GRAPH_PATTERN_MAX_FINDINGS,
} from './thresholds';
import type { DetectOpts, DetectResult, FlaggedFinding, Severity } from './types';

const PATTERN_NAME = 'GEO_ANOMALY' as const;

interface JourneyEnd {
  journeyId: string;
  customerId: string;
  driverId: string | null;
  lat: number;
  lng: number;
}

export async function detect(
  prisma: PrismaClient,
  opts: DetectOpts,
): Promise<DetectResult> {
  const startedAt = Date.now();
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - opts.windowDays * 24 * 60 * 60 * 1000);

  // Use Journey.destinationLat/Lng as the per-journey terminal point. This is
  // cheaper than scanning GpsPoint and is the same coordinate the per-pair
  // patterns use; clusters that look concerning here can be drilled into via
  // the GpsPoint table from the admin UI.
  const journeys = await prisma.journey.findMany({
    where: { status: 'COMPLETED', endedAt: { gte: since } },
    select: {
      id: true,
      customerId: true,
      driverId: true,
      destinationLat: true,
      destinationLng: true,
    },
  });

  const points: ClusterPoint<JourneyEnd>[] = journeys.map((j) => ({
    lat: j.destinationLat,
    lng: j.destinationLng,
    meta: {
      journeyId: j.id,
      customerId: j.customerId,
      driverId: j.driverId,
      lat: j.destinationLat,
      lng: j.destinationLng,
    },
  }));

  const clusters = clusterByRadius(points, GEO_ANOMALY_CLUSTER_RADIUS_M);
  const findings: FlaggedFinding[] = [];
  const seen = new Set<string>();

  for (const cluster of clusters) {
    const totalRides = cluster.members.length;
    if (totalRides < GEO_ANOMALY_MIN_RIDES_PER_WEEK) continue;

    const customers = new Set(cluster.members.map((m) => m.customerId));
    if (customers.size >= GEO_ANOMALY_MIN_DISTINCT_CUSTOMERS) continue;

    const drivers = new Set(
      cluster.members.map((m) => m.driverId).filter((d): d is string => Boolean(d)),
    );
    const rideCustomerRatio = totalRides / customers.size;
    const severity: Severity = rideCustomerRatio > 5 ? 'HIGH' : 'MEDIUM';
    const meta = {
      clusterCentroid: cluster.centroid,
      clusterRadiusM: GEO_ANOMALY_CLUSTER_RADIUS_M,
      totalRides,
      distinctCustomers: customers.size,
      rideCustomerRatio,
      windowDays: opts.windowDays,
    };

    for (const id of [...customers, ...drivers]) {
      if (findings.length >= GRAPH_PATTERN_MAX_FINDINGS) break;
      if (seen.has(id)) continue;
      seen.add(id);
      findings.push({ userId: id, severity, metadata: meta });
    }
    if (findings.length >= GRAPH_PATTERN_MAX_FINDINGS) break;
  }

  return {
    patternName: PATTERN_NAME,
    flagged: findings,
    scannedNodes: points.length,
    durationMs: Date.now() - startedAt,
  };
}
