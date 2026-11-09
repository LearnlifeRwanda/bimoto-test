import { create } from 'zustand';
import type {
  EmergencyAlertEvent,
  EmergencyEndedEvent,
  EmergencyLocationUpdateEvent,
} from '@bimoto/shared';

// SOS-WIRE G3 — admin-facing emergency alerts. Module-level store (not
// component state) so alerts survive admin route navigation: AdminGuard
// remounts per route, and a life-safety banner must not vanish on a
// page change. Dismissal is ONLY via explicit acknowledgement.

export interface AdminEmergencyAlert extends EmergencyAlertEvent {
  /** re-alert count: repeated SOS taps for the same journey update the
   *  existing banner instead of stacking duplicates */
  count: number;
}

/**
 * SOS-FOLLOW G5 — the last position ops has for one person on one
 * journey, and WHEN it arrived.
 *
 * `at` is the whole reason this is a record rather than a coordinate.
 * The follow is a stream over a phone network in Kigali and it goes
 * quiet: a tunnel, a dead battery, a phone in a pocket. A map that
 * silently keeps showing the last dot it received tells an operator that
 * somebody is standing still when in fact nobody has heard from them for
 * four minutes, and those are opposite facts. So the age is carried with
 * the position and printed beside it. Silence is information, and the
 * screen says so rather than smoothing it over.
 */
export interface EmergencyFollowPosition {
  journeyId: string;
  userId: string;
  role: 'CUSTOMER' | 'DRIVER';
  lat: number;
  lng: number;
  accuracy?: number | null;
  /** Server clock, ISO — see above. */
  at: string;
}

interface EmergencyAlertState {
  alerts: AdminEmergencyAlert[];
  /**
   * SOS-FOLLOW G5 — live follow positions, keyed `${alertId}:${userId}`.
   *
   * Per USER, not per alert: both participants stream, and on the ride
   * that matters most the two dots are in different places. Collapsing
   * them to one position per alert would show ops whichever phone
   * reported last and hide the other.
   */
  positions: Record<string, EmergencyFollowPosition>;
  addAlert: (event: EmergencyAlertEvent) => void;
  acknowledgeAlert: (journeyId: string) => void;
  /** A frame relayed from the 'admins' room. */
  addPosition: (event: EmergencyLocationUpdateEvent) => void;
  /**
   * An alert ended. The banner goes, and so do its positions — a closed
   * emergency must not leave a dot on an operator's screen.
   */
  alertEnded: (event: EmergencyEndedEvent) => void;
}

/** The key positions are stored under. Exported for the ops view's reads. */
export const followKey = (alertId: string, userId: string) => `${alertId}:${userId}`;

export const useEmergencyAlertStore = create<EmergencyAlertState>((set) => ({
  alerts: [],
  positions: {},
  addAlert: (event) =>
    set((state) => {
      const existing = state.alerts.find((a) => a.journeyId === event.journeyId);
      if (existing) {
        return {
          alerts: state.alerts.map((a) =>
            a.journeyId === event.journeyId
              ? { ...a, ...event, count: a.count + 1 }
              : a,
          ),
        };
      }
      return { alerts: [...state.alerts, { ...event, count: 1 }] };
    }),
  acknowledgeAlert: (journeyId) =>
    set((state) => ({
      alerts: state.alerts.filter((a) => a.journeyId !== journeyId),
    })),
  addPosition: (event) =>
    set((state) => ({
      positions: {
        ...state.positions,
        [followKey(event.alertId, event.userId)]: {
          journeyId: event.journeyId,
          userId: event.userId,
          role: event.role,
          lat: event.lat,
          lng: event.lng,
          accuracy: event.accuracy ?? null,
          at: event.at,
        },
      },
    })),
  alertEnded: (event) =>
    set((state) => {
      const prefix = `${event.alertId}:`;
      const positions: Record<string, EmergencyFollowPosition> = {};
      for (const [key, value] of Object.entries(state.positions)) {
        if (!key.startsWith(prefix)) positions[key] = value;
      }
      return {
        // Acknowledgement is still the only way a banner is DISMISSED by
        // a person. This is different: the emergency is over, so there is
        // nothing left to acknowledge.
        alerts: state.alerts.filter((a) => a.journeyId !== event.journeyId),
        positions,
      };
    }),
}));
