import { haversineDistance } from '../../utils/geo';

/** Great-circle distance in metres between two lat/lng pairs. */
export function haversineMetres(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  return haversineDistance(lat1, lng1, lat2, lng2) * 1000;
}
