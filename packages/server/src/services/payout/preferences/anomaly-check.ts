const DEFAULT_THRESHOLD_RWF = 50_000;

export interface AnomalyCheckInput {
  userId: string;
  pendingBalance: number;
}

export interface AnomalyVerdict {
  allowAuto: boolean;
  reason?: 'EXCEEDS_THRESHOLD';
  thresholdRwf: number;
}

function readThreshold(): number {
  const raw = process.env.ANOMALY_PAYOUT_THRESHOLD;
  if (!raw) return DEFAULT_THRESHOLD_RWF;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_THRESHOLD_RWF;
  return parsed;
}

export async function getPreferenceChangeAnomalyVerdict(
  input: AnomalyCheckInput,
): Promise<AnomalyVerdict> {
  const thresholdRwf = readThreshold();
  if (input.pendingBalance > thresholdRwf) {
    return { allowAuto: false, reason: 'EXCEEDS_THRESHOLD', thresholdRwf };
  }
  return { allowAuto: true, thresholdRwf };
}
