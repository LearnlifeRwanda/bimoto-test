// LIB/EMERGENCY-API.TS
//
// SOS-FOLLOW G5 — the ops emergency surface's data layer: the row shapes
// the server sends and the three calls the screen makes. Kept out of the
// components so the screen file stays about what an operator sees.
//
// Two reads and one write. The write is the only one that matters:
// resolving is how an emergency ends, and everything this dispatch built
// — the state row, the follow stream, the retention hold — is defensible
// only because a person can reach that button.

import { apiFetch } from './api';

export type EmergencyAlertStatusName = 'ACTIVE' | 'RESOLVED' | 'EXPIRED';

/** An open alert, as the ACTIVE list serves it. */
export interface ActiveEmergencyAlert {
  id: string;
  journeyId: string;
  raisedById: string;
  raisedByRole: 'CUSTOMER' | 'DRIVER';
  /** Where the phone was at the press, when it could say. Often null. */
  pressLat: number | null;
  pressLng: number | null;
  createdAt: string;
  journey: {
    type: string | null;
    status: string | null;
    pickupName: string | null;
    destinationName: string | null;
  } | null;
  raisedBy: { nickname: string | null } | null;
}

/** A closed alert, as the history serves it. */
export interface ClosedEmergencyAlert {
  id: string;
  journeyId: string;
  raisedByRole: 'CUSTOMER' | 'DRIVER';
  status: Exclude<EmergencyAlertStatusName, 'ACTIVE'>;
  createdAt: string;
  resolvedAt: string | null;
  resolveNote: string | null;
  journey: { type: string | null } | null;
  raisedBy: { nickname: string | null } | null;
  /** Null when the valve expired it rather than a person closing it. */
  resolvedBy: { nickname: string | null } | null;
}

export async function fetchActiveEmergencyAlerts(): Promise<ActiveEmergencyAlert[]> {
  const res = await apiFetch('/api/admin/emergency/active', { credentials: 'include' });
  if (!res.ok) throw new Error(`active alerts failed: ${res.status}`);
  const body = (await res.json()) as { alerts?: ActiveEmergencyAlert[] };
  return body.alerts ?? [];
}

export async function fetchEmergencyHistory(limit?: number): Promise<ClosedEmergencyAlert[]> {
  const qs = limit ? `?limit=${limit}` : '';
  const res = await apiFetch(`/api/admin/emergency/history${qs}`, { credentials: 'include' });
  if (!res.ok) throw new Error(`emergency history failed: ${res.status}`);
  const body = (await res.json()) as { alerts?: ClosedEmergencyAlert[] };
  return body.alerts ?? [];
}

/**
 * End one alert. The note is required and the server holds it to
 * ADMIN_REASON_MIN_LENGTH; this is not re-derived here, because a
 * client-side length check that drifts from the server's is worse than
 * none. The screen shows what the server said.
 */
export async function resolveEmergencyAlert(alertId: string, note: string): Promise<void> {
  const res = await apiFetch(`/api/admin/emergency/${alertId}/resolve`, {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify({ note }),
  });
  if (!res.ok) throw new Error(`resolve failed: ${res.status}`);
}
