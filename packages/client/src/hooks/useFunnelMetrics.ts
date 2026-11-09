// HOOKS/USE-FUNNEL-METRICS.TS
//
// R3-FUNNEL-METRICS-DASHBOARD — client hook for the admin funnel page.
// Mirrors the credentials-include fetch pattern used elsewhere in the
// admin app (see AdminConflicts.tsx).

import { useCallback, useEffect, useState } from 'react';
import type { CityBand } from '@bimoto/shared';
import { apiFetch } from '../lib/api';

export interface FunnelMetricsResult {
  weekOf: string;
  filters: { cityBand?: CityBand; cooperativeId?: string };
  funnel: {
    registered: number[];
    screenerQualified: number[];
    onboarded: number[];
    active: number[];
  };
  operational: {
    timeToFirstBidMedianMinutes: number[];
    bidsPerRideMean: number[];
    acceptanceRate: number[];
    cancellationRate: number[];
    parcelRecipientConfirmationRate: number[];
    offlineSyncSuccessRate: number[];
  };
  meta: {
    computedAt: string;
  };
}

export interface UseFunnelMetricsParams {
  weekOf: string;
  cityBand?: CityBand;
  cooperativeId?: string;
}

export function useFunnelMetrics(params: UseFunnelMetricsParams): {
  data: FunnelMetricsResult | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
} {
  const [data, setData] = useState<FunnelMetricsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [tick, setTick] = useState(0);

  const { weekOf, cityBand, cooperativeId } = params;

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    const qs = new URLSearchParams({ weekOf });
    if (cityBand) qs.set('cityBand', cityBand);
    if (cooperativeId) qs.set('cooperativeId', cooperativeId);
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiFetch(`/api/admin/funnel/metrics?${qs.toString()}`, {
      credentials: 'include',
    })
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load funnel metrics: ${res.status}`);
        return res.json();
      })
      .then((d: FunnelMetricsResult) => {
        if (!cancelled) setData(d);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [weekOf, cityBand, cooperativeId, tick]);

  return { data, loading, error, refetch };
}
