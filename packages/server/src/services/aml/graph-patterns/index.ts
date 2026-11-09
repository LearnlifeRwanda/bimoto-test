import * as collusionRing from './collusion-ring';
import * as moneyFunnel from './money-funnel';
import * as reputationRing from './reputation-ring';
import * as geoAnomaly from './geo-anomaly';
import * as syncRatingAttack from './sync-rating-attack';
import * as bidCycleRing from './bid-cycle-ring';
import type { PatternModule } from './types';

export const GRAPH_PATTERNS: PatternModule[] = [
  { name: 'COLLUSION_RING', detect: collusionRing.detect },
  { name: 'MONEY_FUNNEL', detect: moneyFunnel.detect },
  { name: 'REPUTATION_RING', detect: reputationRing.detect },
  { name: 'GEO_ANOMALY', detect: geoAnomaly.detect },
  { name: 'SYNC_RATING_ATTACK', detect: syncRatingAttack.detect },
  { name: 'BID_CYCLE_RING', detect: bidCycleRing.detect },
];

export * from './types';
