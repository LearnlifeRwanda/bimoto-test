// R3-N-3 — server-derived approach status for MATCHED journeys.
// "silent"     — no recent GPS broadcast from the driver.
// "approaching" — recent GPS, distance to pickup is closing.
// "arrived"    — recent GPS within ARRIVED_RADIUS_M of pickup.
// "lost"       — recent GPS, far from pickup, not closing.
export type ApproachStatus = 'silent' | 'approaching' | 'arrived' | 'lost';

// Extended payload for GET /api/journeys/:id/eta. The original
// R3-E fields (minutes, confidence, asOf) are preserved verbatim;
// R3-N-3 adds approachStatus + distanceMeters.
export interface EtaResponse {
  minutes: number | null;
  confidence: 'low' | 'med' | 'high' | 'unknown';
  asOf: string | null;
  approachStatus: ApproachStatus | null;
  distanceMeters: number | null;
}
