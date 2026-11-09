import prisma from '../prisma';
import { haversineDistance } from '../utils/geo';
import { getVehicleCompliance } from '@bimoto/shared';

interface GpsPointData {
  lat: number;
  lng: number;
  accuracy: number | null;
  timestamp: Date;
}

export interface ValidationResult {
  valid: boolean;
  flags: string[];
  rawDistanceKm: number;
  cleanedDistanceKm: number;
  expectedDistanceKm: number;
  gpsPointCount: number;
  cleanedPointCount: number;
  outlierCount: number;
}

export function filterGpsOutliers(points: GpsPointData[], maxSpeedKmh: number = 90): {
  cleaned: GpsPointData[];
  outliers: GpsPointData[];
} {
  if (points.length <= 2) return { cleaned: points, outliers: [] };

  const ACCURACY_THRESHOLD_M = 100;
  const cleaned: GpsPointData[] = [points[0]];
  const outliers: GpsPointData[] = [];

  for (let i = 1; i < points.length - 1; i++) {
    const prev = cleaned[cleaned.length - 1];
    const curr = points[i];
    const next = points[i + 1];

    if (curr.accuracy !== null && curr.accuracy > ACCURACY_THRESHOLD_M) {
      outliers.push(curr);
      continue;
    }

    const distPrevCurr = haversineDistance(prev.lat, prev.lng, curr.lat, curr.lng);
    const timePrevCurr = (curr.timestamp.getTime() - prev.timestamp.getTime()) / 3600000;
    const speedPrevCurr = timePrevCurr > 0 ? distPrevCurr / timePrevCurr : 0;

    const distCurrNext = haversineDistance(curr.lat, curr.lng, next.lat, next.lng);
    const timeCurrNext = (next.timestamp.getTime() - curr.timestamp.getTime()) / 3600000;
    const speedCurrNext = timeCurrNext > 0 ? distCurrNext / timeCurrNext : 0;

    const bothDirectionsImplausible =
      speedPrevCurr > maxSpeedKmh && speedCurrNext > maxSpeedKmh;

    const distSkip = haversineDistance(prev.lat, prev.lng, next.lat, next.lng);
    const timeSkip = (next.timestamp.getTime() - prev.timestamp.getTime()) / 3600000;
    const speedSkip = timeSkip > 0 ? distSkip / timeSkip : 0;
    const skipWouldBePlausible = speedSkip <= maxSpeedKmh;

    if (bothDirectionsImplausible && skipWouldBePlausible) {
      outliers.push(curr);
    } else {
      cleaned.push(curr);
    }
  }

  cleaned.push(points[points.length - 1]);

  return { cleaned, outliers };
}

function calculateTraceDistance(points: GpsPointData[]): number {
  let distance = 0;
  for (let i = 1; i < points.length; i++) {
    distance += haversineDistance(
      points[i - 1].lat, points[i - 1].lng,
      points[i].lat, points[i].lng,
    );
  }
  return distance;
}

function calculateMedianSpeed(points: GpsPointData[]): number {
  if (points.length < 2) return 0;
  const speeds: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const dist = haversineDistance(
      points[i - 1].lat, points[i - 1].lng,
      points[i].lat, points[i].lng,
    );
    const timeH = (points[i].timestamp.getTime() - points[i - 1].timestamp.getTime()) / 3600000;
    if (timeH > 0) speeds.push(dist / timeH);
  }
  if (speeds.length === 0) return 0;
  speeds.sort((a, b) => a - b);
  const mid = Math.floor(speeds.length / 2);
  return speeds.length % 2 === 0
    ? (speeds[mid - 1] + speeds[mid]) / 2
    : speeds[mid];
}

export async function validateJourneyPlausibility(journeyId: string): Promise<ValidationResult> {
  const journey = await prisma.journey.findUnique({
    where: { id: journeyId },
    include: { driver: { include: { driverProfile: true } } },
  });
  if (!journey) throw new Error('Journey not found');

  // Get the vehicle-specific speed limit
  const vehicleType = journey.driver?.driverProfile?.vehicleType || 'MOTO';
  const compliance = getVehicleCompliance(vehicleType);
  const maxSpeed = compliance.maxPlausibleSpeedKmh;

  const rawPoints = await prisma.gpsPoint.findMany({
    where: { journeyId },
    orderBy: { timestamp: 'asc' },
  });

  const flags: string[] = [];
  const expectedDistance = journey.estimatedDistance ?? 0;

  const points: GpsPointData[] = rawPoints.map((p: any) => ({
    lat: p.lat, lng: p.lng, accuracy: p.accuracy, timestamp: p.timestamp,
  }));

  const { cleaned, outliers } = filterGpsOutliers(points, maxSpeed);
  const rawDistance = calculateTraceDistance(points);
  const cleanedDistance = calculateTraceDistance(cleaned);

  if (points.length === 0) {
    flags.push('NO_GPS_DATA');
  }

  if (journey.startedAt && journey.endedAt && points.length > 0) {
    const durationMinutes = (journey.endedAt.getTime() - journey.startedAt.getTime()) / 60000;
    if (durationMinutes > 2 && points.length < durationMinutes * 0.5) {
      flags.push('SPARSE_GPS_DATA');
    }
  }

  if (points.length >= 10 && outliers.length / points.length > 0.4) {
    flags.push('EXCESSIVE_GPS_NOISE');
  }

  if (expectedDistance > 0.5 && cleanedDistance < expectedDistance * 0.2) {
    flags.push('DISTANCE_TOO_SHORT');
  }

  if (expectedDistance > 0.5 && cleanedDistance > expectedDistance * 4.0) {
    flags.push('DISTANCE_TOO_LONG');
  }

  if (cleaned.length >= 3) {
    const medianSpeed = calculateMedianSpeed(cleaned);
    if (medianSpeed > maxSpeed * 0.9) { // 90% of max plausible speed
      flags.push('IMPLAUSIBLE_SPEED');
    }
    if (cleanedDistance > 2 && medianSpeed > 0 && medianSpeed < 3) {
      flags.push('IMPLAUSIBLE_SLOW');
    }
  }

  if (journey.startedAt && journey.endedAt && cleanedDistance > 1) {
    const durationHours = (journey.endedAt.getTime() - journey.startedAt.getTime()) / 3600000;
    if (durationHours > 0 && cleanedDistance / durationHours > maxSpeed * 0.9) {
      flags.push('DURATION_TOO_SHORT_FOR_DISTANCE');
    }
  }

  return {
    valid: flags.length === 0,
    flags,
    rawDistanceKm: Math.round(rawDistance * 100) / 100,
    cleanedDistanceKm: Math.round(cleanedDistance * 100) / 100,
    expectedDistanceKm: Math.round(expectedDistance * 100) / 100,
    gpsPointCount: points.length,
    cleanedPointCount: cleaned.length,
    outlierCount: outliers.length,
  };
}
