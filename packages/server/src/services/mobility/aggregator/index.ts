// SERVICES/MOBILITY/AGGREGATOR/INDEX.TS
//
// Module registry for mobility aggregators. Each module has a stable
// `name` (matching the MobilityAggregateType enum) and an `aggregate`
// function. The cron iterates this list, isolating per-module failures.

import { aggregatePointDensity } from './point-density';
import { aggregateOdMatrix } from './od-matrix';
import type { AggregateModule } from '../types';

export const AGGREGATOR_MODULES: AggregateModule[] = [
  { name: 'POINT_DENSITY', aggregate: aggregatePointDensity },
  { name: 'OD_MATRIX', aggregate: aggregateOdMatrix },
];

export { aggregatePointDensity } from './point-density';
export { aggregateOdMatrix } from './od-matrix';
