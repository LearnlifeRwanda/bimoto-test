import type { PrismaClient } from '@prisma/client';
import {
  bipartiteDensity,
  connectedComponents,
  externalEdgeRatio,
  type Edge,
} from './utils';
import {
  COLLUSION_RING_DENSITY_MIN,
  COLLUSION_RING_EXTERNAL_RATIO_MAX,
  COLLUSION_RING_MIN_NODES,
  COLLUSION_RING_MIN_RIDES,
  GRAPH_PATTERN_MAX_FINDINGS,
} from './thresholds';
import type { DetectOpts, DetectResult, FlaggedFinding, Severity } from './types';

const PATTERN_NAME = 'COLLUSION_RING' as const;

export async function detect(
  prisma: PrismaClient,
  opts: DetectOpts,
): Promise<DetectResult> {
  const startedAt = Date.now();
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - opts.windowDays * 24 * 60 * 60 * 1000);

  const journeys = await prisma.journey.findMany({
    where: {
      status: 'COMPLETED',
      driverId: { not: null },
      createdAt: { gte: since },
    },
    select: { customerId: true, driverId: true },
  });

  const allEdges: Edge[] = journeys
    .filter((j) => j.driverId)
    .map((j) => [j.customerId, j.driverId as string] as Edge);

  const components = connectedComponents(allEdges);
  const findings: FlaggedFinding[] = [];

  for (const component of components) {
    if (component.length < COLLUSION_RING_MIN_NODES) continue;

    const compSet = new Set(component);
    const users = await prisma.user.findMany({
      where: { id: { in: component } },
      select: { id: true, role: true },
    });
    const customers = new Set(
      users.filter((u) => u.role === 'CUSTOMER').map((u) => u.id),
    );
    const drivers = new Set(
      users.filter((u) => u.role === 'DRIVER').map((u) => u.id),
    );
    if (customers.size === 0 || drivers.size === 0) continue;

    const internalEdges = allEdges.filter(
      ([u, v]) => compSet.has(u) && compSet.has(v),
    );
    const totalRides = internalEdges.length;
    if (totalRides < COLLUSION_RING_MIN_RIDES) continue;

    const density = bipartiteDensity(internalEdges, customers, drivers);
    const extRatio = externalEdgeRatio(allEdges, compSet);

    if (
      density < COLLUSION_RING_DENSITY_MIN ||
      extRatio > COLLUSION_RING_EXTERNAL_RATIO_MAX
    ) {
      continue;
    }

    const severity: Severity =
      density >= 0.85 && extRatio < 0.05 ? 'CRITICAL' : 'HIGH';

    // Blast-radius trim: only members more connected than the ring's
    // median carry the full component severity; the periphery of a
    // CRITICAL component is capped at HIGH. A uniform-degree ring has
    // no periphery, so everyone keeps the component severity.
    const internalDegree = new Map<string, number>();
    for (const [u, v] of internalEdges) {
      internalDegree.set(u, (internalDegree.get(u) ?? 0) + 1);
      internalDegree.set(v, (internalDegree.get(v) ?? 0) + 1);
    }
    const sortedDegrees = component
      .map((id) => internalDegree.get(id) ?? 0)
      .sort((a, b) => a - b);
    const mid = Math.floor(sortedDegrees.length / 2);
    const medianDegree =
      sortedDegrees.length % 2 === 1
        ? sortedDegrees[mid]
        : (sortedDegrees[mid - 1] + sortedDegrees[mid]) / 2;
    const uniformDegree = sortedDegrees[0] === sortedDegrees[sortedDegrees.length - 1];

    for (const userId of component) {
      if (findings.length >= GRAPH_PATTERN_MAX_FINDINGS) break;
      const memberDegree = internalDegree.get(userId) ?? 0;
      const memberSeverity: Severity =
        uniformDegree || memberDegree > medianDegree ? severity : 'HIGH';
      findings.push({
        userId,
        severity: memberSeverity,
        metadata: {
          ringMembers: component,
          density,
          totalRides,
          windowDays: opts.windowDays,
          externalEdgeRatio: extRatio,
          internalDegree: memberDegree,
          componentMedianDegree: medianDegree,
        },
      });
    }
    if (findings.length >= GRAPH_PATTERN_MAX_FINDINGS) break;
  }

  return {
    patternName: PATTERN_NAME,
    flagged: findings,
    scannedNodes: new Set(allEdges.flat()).size,
    durationMs: Date.now() - startedAt,
  };
}
