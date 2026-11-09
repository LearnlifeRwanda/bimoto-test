import { haversineMetres } from './haversine';

export type EtaConfidence = 'low' | 'med' | 'high' | 'unknown';
export type EtaMode = 'BIKE' | 'MOTO' | 'E_MOTO' | 'E_BIKE' | 'CAR';

// Calibrated for the Kigali pilot. Revise from operational data
// after first 100 rides.
const URBAN_SPEED_KMH: Record<EtaMode, number> = {
  BIKE: 12,
  E_BIKE: 18,
  MOTO: 25,
  E_MOTO: 28,
  CAR: 20,
};

export interface EtaEstimate {
  minutes: number;
  confidence: Exclude<EtaConfidence, 'unknown'>;
}

/**
 * Straight-line ETA assuming a single average urban speed. Honest enough
 * for a pilot; upgrade to a routing API is a separate dispatch (R6).
 */
export function estimateMinutes(
  driverLat: number,
  driverLng: number,
  customerLat: number,
  customerLng: number,
  mode: EtaMode = 'MOTO',
): EtaEstimate {
  const metres = haversineMetres(driverLat, driverLng, customerLat, customerLng);
  const speedKmh = URBAN_SPEED_KMH[mode];
  const speedMps = (speedKmh * 1000) / 3600;
  const seconds = metres / speedMps;
  const minutes = Math.max(1, Math.round(seconds / 60));

  let confidence: EtaEstimate['confidence'];
  if (metres < 1000) confidence = 'high';
  else if (metres <= 5000) confidence = 'med';
  else confidence = 'low';

  return { minutes, confidence };
}
