// All graph-pattern thresholds env-overridable. Defaults conservative for the
// Kigali pilot — see Dispatch I §2 for rationale on each value.

// Collusion-ring
export const COLLUSION_RING_DENSITY_MIN = parseFloat(
  process.env.GRAPH_COLLUSION_DENSITY_MIN ?? '0.6',
);
export const COLLUSION_RING_MIN_RIDES = parseInt(
  process.env.GRAPH_COLLUSION_MIN_RIDES ?? '15',
  10,
);
export const COLLUSION_RING_MIN_NODES = parseInt(
  process.env.GRAPH_COLLUSION_MIN_NODES ?? '4',
  10,
);
export const COLLUSION_RING_EXTERNAL_RATIO_MAX = parseFloat(
  process.env.GRAPH_COLLUSION_EXTERNAL_MAX ?? '0.1',
);

// Money-funnel
export const MONEY_FUNNEL_TOP_CUSTOMER_RATIO = parseFloat(
  process.env.GRAPH_FUNNEL_TOP_RATIO ?? '0.7',
);
export const MONEY_FUNNEL_MAX_DISTINCT = parseInt(
  process.env.GRAPH_FUNNEL_MAX_DISTINCT ?? '5',
  10,
);
export const MONEY_FUNNEL_MIN_AMOUNT_RWF = parseInt(
  process.env.GRAPH_FUNNEL_MIN_AMOUNT_RWF ?? '500000',
  10,
);
// Concentration among few payers is only evidence when the driver has many payers overall.
export const MONEY_FUNNEL_MIN_TOTAL_CUSTOMERS = parseInt(
  process.env.GRAPH_FUNNEL_MIN_TOTAL_CUSTOMERS ?? '8',
  10,
);

// Reputation-ring
export const REPUTATION_RING_MIN_RATINGS = parseInt(
  process.env.GRAPH_REPUTATION_MIN_RATINGS ?? '5',
  10,
);
export const REPUTATION_RING_MAX_DRIVERS = parseInt(
  process.env.GRAPH_REPUTATION_MAX_DRIVERS ?? '3',
  10,
);
export const REPUTATION_RING_MIN_AVG_STARS = parseFloat(
  process.env.GRAPH_REPUTATION_MIN_STARS ?? '4.5',
);
export const REPUTATION_RING_CLIQUE_MAX = parseInt(
  process.env.GRAPH_REPUTATION_CLIQUE_MAX ?? '6',
  10,
);

// Geo-anomaly
export const GEO_ANOMALY_MIN_RIDES_PER_WEEK = parseInt(
  process.env.GRAPH_GEO_MIN_RIDES ?? '20',
  10,
);
export const GEO_ANOMALY_MIN_DISTINCT_CUSTOMERS = parseInt(
  process.env.GRAPH_GEO_MIN_CUSTOMERS ?? '30',
  10,
);
export const GEO_ANOMALY_CLUSTER_RADIUS_M = parseInt(
  process.env.GRAPH_GEO_RADIUS_M ?? '100',
  10,
);

// Sync-rating-attack
export const SYNC_RATING_WINDOW_MIN = parseInt(
  process.env.GRAPH_SYNC_RATING_WINDOW_MIN ?? '5',
  10,
);
export const SYNC_RATING_MIN_COUNT = parseInt(
  process.env.GRAPH_SYNC_RATING_MIN_COUNT ?? '5',
  10,
);
export const SYNC_RATING_FIRST_TIME_RATIO = parseFloat(
  process.env.GRAPH_SYNC_RATING_FIRST_TIME_RATIO ?? '0.8',
);

// Bid-cycle-ring
export const BID_CYCLE_MIN_PAIRS = parseInt(
  process.env.GRAPH_BID_CYCLE_MIN_PAIRS ?? '3',
  10,
);
export const BID_CYCLE_WINDOW_HOURS = parseInt(
  process.env.GRAPH_BID_CYCLE_WINDOW_HOURS ?? '24',
  10,
);
export const BID_CYCLE_MIN_PER_PAIR = parseInt(
  process.env.GRAPH_BID_CYCLE_MIN_PER_PAIR ?? '3',
  10,
);

// Job
export const GRAPH_DETECTION_CRON = process.env.GRAPH_DETECTION_CRON ?? '0 3 * * *';
export const GRAPH_DETECTION_WINDOW_DAYS = parseInt(
  process.env.GRAPH_DETECTION_WINDOW_DAYS ?? '7',
  10,
);
export const GRAPH_DETECTION_TIMEOUT_MS = parseInt(
  process.env.GRAPH_DETECTION_TIMEOUT_MS ?? '600000',
  10,
);

// Per-pattern emit cap to prevent runaway false positives flooding AmlFlag.
export const GRAPH_PATTERN_MAX_FINDINGS = parseInt(
  process.env.GRAPH_PATTERN_MAX_FINDINGS ?? '100',
  10,
);
