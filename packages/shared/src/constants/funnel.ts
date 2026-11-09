// CONSTANTS/FUNNEL.TS
//
// R3-FUNNEL-METRICS-DASHBOARD — shared funnel-metrics constants.
// Imported by both server (services/funnel-metrics.service.ts) and
// client (pages/admin/AdminFunnel.tsx + hooks/useFunnelMetrics.ts).

export const ACTIVE_DRIVER_TRIP_THRESHOLD = 3 as const;
export const ACTIVE_DRIVER_WINDOW_DAYS = 7 as const;

export const TIME_TO_FIRST_BID_TARGET_MEDIAN_MINUTES = 2 as const;
export const TIME_TO_FIRST_BID_GO_NO_GO_MAX_MINUTES = 5 as const;

export const BIDS_PER_RIDE_TARGET_MEAN = 5 as const;
export const BIDS_PER_RIDE_GO_NO_GO_MIN_MEAN = 3 as const;

export type CityBand =
  | 'kigali_dense'
  | 'kigali_periphery'
  | 'bugesera_corridor'
  | 'other';

export const CITY_BAND_KEYS: readonly CityBand[] = [
  'kigali_dense',
  'kigali_periphery',
  'bugesera_corridor',
  'other',
] as const;

export type FunnelStage =
  | 'registered'
  | 'screener_qualified'
  | 'onboarded'
  | 'active';

export const FUNNEL_STAGE_KEYS: readonly FunnelStage[] = [
  'registered',
  'screener_qualified',
  'onboarded',
  'active',
] as const;

export const FUNNEL_LOOKBACK_WEEKS = 5 as const;
