import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SOCKET_EVENTS, type EmergencyLocationUpdateEvent, type EmergencyEndedEvent } from '@bimoto/shared';
import { useSocket } from '../../hooks/useSocket';
import {
  useEmergencyAlertStore,
  followKey,
  type EmergencyFollowPosition,
} from '../../stores/emergency-alert.store';
import {
  fetchActiveEmergencyAlerts,
  fetchEmergencyHistory,
  resolveEmergencyAlert,
  type ActiveEmergencyAlert,
  type ClosedEmergencyAlert,
} from '../../lib/emergency-api';
import { EmergencyFollowMap } from '../../components/admin/EmergencyFollowMap';
import { Button } from '../../components/ui/Button';
import { ADMIN_REASON_MIN_LENGTH } from '@bimoto/shared';

// SOS-FOLLOW G5 — the ops emergency surface.
//
// WHY A PAGE AND NOT THE BANNER. AdminEmergencyAlerts is a fixed strip
// across the top of every /admin route: unmissable, and correct for what
// it does, which is to interrupt whatever an operator was doing. It is
// the wrong place for a map, a history and a form — a persistent overlay
// that grows a tab bar stops being an alert. So the banner keeps its
// job (and its Acknowledge, unchanged) and gains a link here; this page
// is where an emergency is actually worked.
//
// THE LIST IS OLDEST FIRST, from the server. The oldest open alert is
// the one nobody has dealt with.
//
// AGES ARE PRINTED, NOT SMOOTHED. Every position on this screen carries
// how old it is, and the ticking clock below is what keeps that honest
// while nothing arrives. A follow over a phone network goes quiet — a
// tunnel, a flat battery, a phone in a pocket — and a map that keeps
// showing the last dot without saying when it arrived tells an operator
// somebody is standing still when in truth nobody has heard from them
// for four minutes. Those are opposite facts and only one of them is
// true. Silence is information; this page says it out loud.
export const AdminEmergency: React.FC = () => {
  const { t } = useTranslation();
  const { socket, isConnected } = useSocket();

  const positions = useEmergencyAlertStore((s) => s.positions);
  const addPosition = useEmergencyAlertStore((s) => s.addPosition);
  const alertEnded = useEmergencyAlertStore((s) => s.alertEnded);

  const [active, setActive] = useState<ActiveEmergencyAlert[]>([]);
  const [history, setHistory] = useState<ClosedEmergencyAlert[]>([]);
  const [tab, setTab] = useState<'active' | 'history'>('active');
  const [loadError, setLoadError] = useState(false);

  // A clock, purely so the ages below keep counting while no frame
  // arrives. Nothing is fetched on this tick.
  const [, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);

  const reload = useCallback(async () => {
    try {
      const [a, h] = await Promise.all([
        fetchActiveEmergencyAlerts(),
        fetchEmergencyHistory(),
      ]);
      setActive(a);
      setHistory(h);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  // The live half. EMERGENCY_LOCATION_UPDATE only ever reaches the
  // 'admins' room, which admin-role sockets join at connect; there is no
  // other listener for it anywhere in this application.
  useEffect(() => {
    if (!socket) return;
    const onPosition = (event: EmergencyLocationUpdateEvent) => addPosition(event);
    const onEnded = (event: EmergencyEndedEvent) => {
      alertEnded(event);
      setActive((list) => list.filter((a) => a.id !== event.alertId));
      // Somebody else's resolve is still a resolve: refresh so it lands
      // in the history tab with its note.
      void reload();
    };
    socket.on(SOCKET_EVENTS.EMERGENCY_LOCATION_UPDATE, onPosition);
    socket.on(SOCKET_EVENTS.EMERGENCY_ENDED, onEnded);
    return () => {
      socket.off(SOCKET_EVENTS.EMERGENCY_LOCATION_UPDATE, onPosition);
      socket.off(SOCKET_EVENTS.EMERGENCY_ENDED, onEnded);
    };
  }, [socket, isConnected, addPosition, alertEnded, reload]);

  return (
    <div className="p-4 max-w-3xl mx-auto" data-testid="admin-emergency">
      <h1 className="text-xl font-bold mb-1">{t('emergency.opsTitle')}</h1>
      <p className="text-sm text-gray-600 mb-4">{t('emergency.opsIntro')}</p>

      <div className="flex gap-2 mb-4" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'active'}
          onClick={() => setTab('active')}
          data-testid="emergency-tab-active"
          className={`min-h-[44px] px-4 rounded-lg font-semibold text-sm ${
            tab === 'active' ? 'bg-[#E74C3C] text-white' : 'bg-gray-100 text-gray-800'
          }`}
        >
          {t('emergency.opsTabActive', { count: active.length })}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'history'}
          onClick={() => setTab('history')}
          data-testid="emergency-tab-history"
          className={`min-h-[44px] px-4 rounded-lg font-semibold text-sm ${
            tab === 'history' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-800'
          }`}
        >
          {t('emergency.opsTabHistory')}
        </button>
      </div>

      {loadError && (
        <p className="mb-4 text-sm text-red-700" role="status">
          {t('emergency.opsLoadFailed')}
        </p>
      )}

      {tab === 'active' ? (
        active.length === 0 ? (
          <p className="text-sm text-gray-600" data-testid="emergency-active-empty">
            {t('emergency.opsNoneActive')}
          </p>
        ) : (
          <ul className="space-y-4">
            {active.map((alert) => (
              <ActiveAlertCard
                key={alert.id}
                alert={alert}
                positions={positionsFor(positions, alert.id)}
                onResolved={reload}
              />
            ))}
          </ul>
        )
      ) : history.length === 0 ? (
        <p className="text-sm text-gray-600" data-testid="emergency-history-empty">
          {t('emergency.opsNoneClosed')}
        </p>
      ) : (
        <ul className="space-y-3">
          {history.map((alert) => (
            <ClosedAlertRow key={alert.id} alert={alert} />
          ))}
        </ul>
      )}
    </div>
  );
};

function positionsFor(
  all: Record<string, EmergencyFollowPosition>,
  alertId: string,
): EmergencyFollowPosition[] {
  const prefix = followKey(alertId, '');
  return Object.entries(all)
    .filter(([key]) => key.startsWith(prefix))
    .map(([, value]) => value);
}

/** Whole seconds since an ISO instant, floored at zero. */
export function ageSeconds(iso: string, now = Date.now()): number {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.floor((now - then) / 1000));
}

const ActiveAlertCard: React.FC<{
  alert: ActiveEmergencyAlert;
  positions: EmergencyFollowPosition[];
  onResolved: () => void;
}> = ({ alert, positions, onResolved }) => {
  const { t } = useTranslation();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const tooShort = note.trim().length < ADMIN_REASON_MIN_LENGTH;

  const submit = useCallback(async () => {
    if (tooShort || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await resolveEmergencyAlert(alert.id, note.trim());
      onResolved();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }, [alert.id, note, tooShort, busy, onResolved]);

  const raiserLabel = alert.raisedByRole === 'DRIVER'
    ? t('emergency.opsRaisedByDriver')
    : t('emergency.opsRaisedByCustomer');

  const openFor = useMemo(() => ageSeconds(alert.createdAt), [alert.createdAt]);

  return (
    <li
      className="border-2 border-[#E74C3C] rounded-lg p-3 space-y-3"
      data-testid="emergency-active-card"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-bold" data-testid="emergency-active-raiser">
          {raiserLabel}
          {alert.raisedBy?.nickname ? ` — ${alert.raisedBy.nickname}` : ''}
        </span>
        <span className="text-sm text-gray-600" data-testid="emergency-active-age">
          {t('emergency.opsOpenFor', { age: humanAge(openFor, t as Translate) })}
        </span>
      </div>

      <div className="text-sm text-gray-700">
        {t('emergency.adminJourney')}: <span className="font-mono">{alert.journeyId}</span>
        {alert.journey?.type ? ` · ${alert.journey.type}` : ''}
        {alert.journey?.status ? ` · ${alert.journey.status}` : ''}
      </div>

      <EmergencyFollowMap
        positions={positions}
        pressLat={alert.pressLat}
        pressLng={alert.pressLng}
      />

      {/* The ages, one line per person we are hearing from — and
          nothing at all for a person we are not, which is itself the
          honest reading. */}
      <ul className="text-sm space-y-1" data-testid="emergency-active-positions">
        {positions.length === 0 ? (
          <li className="text-gray-600">{t('emergency.opsNoFramesYet')}</li>
        ) : (
          positions.map((p) => (
            <li key={p.userId} className="flex gap-2">
              <span className="font-medium">
                {p.role === 'DRIVER'
                  ? t('emergency.opsRaisedByDriver')
                  : t('emergency.opsRaisedByCustomer')}
              </span>
              <span className="text-gray-600" data-testid="emergency-position-age">
                {t('emergency.opsLastPosition', { age: humanAge(ageSeconds(p.at), t as Translate) })}
              </span>
            </li>
          ))
        )}
      </ul>

      <div className="space-y-2">
        <label className="block text-sm font-medium" htmlFor={`note-${alert.id}`}>
          {t('emergency.opsResolveNoteLabel')}
        </label>
        <textarea
          id={`note-${alert.id}`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          className="w-full rounded-lg border-2 border-gray-300 p-2 text-sm"
          placeholder={t('emergency.opsResolveNotePlaceholder')}
        />
        {tooShort && note.length > 0 && (
          <p className="text-xs text-gray-600">
            {t('emergency.opsResolveNoteTooShort', { min: ADMIN_REASON_MIN_LENGTH })}
          </p>
        )}
        {failed && (
          <p className="text-sm text-red-700" role="status">
            {t('emergency.opsResolveFailed')}
          </p>
        )}
        <Button
          variant="primary"
          fullWidth
          disabled={tooShort || busy}
          onClick={submit}
        >
          {t('emergency.opsResolve')}
        </Button>
      </div>
    </li>
  );
};

const ClosedAlertRow: React.FC<{ alert: ClosedEmergencyAlert }> = ({ alert }) => {
  const { t } = useTranslation();
  return (
    <li className="border rounded-lg p-3 space-y-1" data-testid="emergency-history-row">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <span
          className={`text-xs font-bold uppercase tracking-wide ${
            alert.status === 'RESOLVED' ? 'text-green-700' : 'text-amber-700'
          }`}
          data-testid="emergency-history-status"
        >
          {alert.status === 'RESOLVED'
            ? t('emergency.opsStatusResolved')
            : t('emergency.opsStatusExpired')}
        </span>
        <span className="text-sm">
          {alert.raisedByRole === 'DRIVER'
            ? t('emergency.opsRaisedByDriver')
            : t('emergency.opsRaisedByCustomer')}
          {alert.raisedBy?.nickname ? ` — ${alert.raisedBy.nickname}` : ''}
        </span>
        <span className="text-xs text-gray-500">
          {new Date(alert.createdAt).toLocaleString()}
        </span>
      </div>
      <div className="text-xs text-gray-600 font-mono">{alert.journeyId}</div>
      {/* The note is the point of the history. An emergency that ended
          without one being readable here would be an emergency nobody
          can learn from. */}
      {alert.resolveNote && (
        <p className="text-sm text-gray-800" data-testid="emergency-history-note">
          {alert.resolveNote}
        </p>
      )}
      {alert.resolvedBy?.nickname && (
        <p className="text-xs text-gray-500">
          {t('emergency.opsClosedBy', { name: alert.resolvedBy.nickname })}
        </p>
      )}
    </li>
  );
};

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Seconds into the shortest true phrase: "40 s", "4 min", "2 h". */
function humanAge(seconds: number, t: Translate): string {
  if (seconds < 60) return t('emergency.opsAgeSeconds', { seconds });
  if (seconds < 3600) return t('emergency.opsAgeMinutes', { minutes: Math.floor(seconds / 60) });
  return t('emergency.opsAgeHours', { hours: Math.floor(seconds / 3600) });
}

export default AdminEmergency;
