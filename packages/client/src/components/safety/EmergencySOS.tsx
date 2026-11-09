import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { EmergencyButton } from './EmergencyButton';
import { apiFetch } from '../../lib/api';
import { SOS_CANCEL_MS } from '../../config/sos';
import { geolocation } from '../../hooks/useGeolocation';
import { useEmergencyFollowStore } from '../../stores/emergency-follow.store';
import { useEmergencyFollowStream } from '../../hooks/useEmergencyFollowStream';

type NotifyState = 'countdown' | 'sending' | 'sent' | 'failed';

export interface EmergencySOSProps {
  journeyId: string;
}

/**
 * The regret window.
 *
 * QUEUE-UNITY G4 — from config/sos.ts, which reads VITE_SOS_CANCEL_MS at
 * build time and defaults to the same 3000 ms this always was. Unlike
 * the hold, this default did not move: it guards a press someone thought
 * better of, and nothing about that changed.
 */
export const CANCEL_WINDOW_MS = SOS_CANCEL_MS;

// SOS-WIRE G2 / FLIGHT-RECORDER G5 — the customer-side SOS flow.
//
// EmergencyButton provides the trigger (now press-and-hold) and its own
// confirm dialog; confirming opens this sheet, which does BOTH things:
// it notifies the platform (POST /journeys/:id/emergency → record, admin
// banner, ops SMS, contact SMS) and keeps the real call one tap away.
// A failed POST never queues silently — the sheet says Bimoto could not
// be notified and points at 112.
//
// FLIGHT-RECORDER G5 put a three-second cancel window in front of the
// POST. Two things about it matter more than the delay itself:
//
//   - tel:112 is rendered FIRST and is present in every state, including
//     the countdown. The guard is on notifying Bimoto, never on calling
//     the emergency services: from any ride screen that is hold → confirm
//     → tap 112, and 112 is above the fold the whole way.
//   - Cancelling records NOTHING. No request is made, no local note is
//     kept, and the sheet closes. A panic someone thought better of is
//     not an incident, and treating it as one teaches people not to
//     reach for the button.
//
// The endpoint, the payload and the recipients are byte-for-byte what
// RED-BUTTON shipped. Only the moment of firing moved.
export const EmergencySOS: React.FC<EmergencySOSProps> = ({ journeyId }) => {
  const { t } = useTranslation();
  const markActive = useEmergencyFollowStore((st) => st.markActive);
  const clearActive = useEmergencyFollowStore((st) => st.clear);
  const alertId = useEmergencyFollowStore((st) => st.active[journeyId]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [notifyState, setNotifyState] = useState<NotifyState>('countdown');
  const [remainingMs, setRemainingMs] = useState(CANCEL_WINDOW_MS);
  const countdown = useRef<ReturnType<typeof setInterval> | null>(null);
  /**
   * SOS-FOLLOW G4 — the press position, read during the regret window.
   *
   * Filled by a fire-and-forget read started when the countdown starts,
   * so that by the time the POST fires three seconds later a fix has
   * usually arrived — and if it has not, the POST goes without one. The
   * read is never awaited on the sending path; that is the whole reason
   * it happens here rather than there.
   */
  const pressCoords = useRef<{ lat: number; lng: number } | null>(null);

  const stopCountdown = useCallback(() => {
    if (countdown.current) clearInterval(countdown.current);
    countdown.current = null;
  }, []);

  const notifyPlatform = useCallback(async () => {
    setNotifyState('sending');
    try {
      // SOS-FOLLOW G4 — where the phone was at the press, when it could
      // say so IN TIME. Whatever the read started at the top of the
      // regret window has produced by now, and nothing is waited for
      // here: the position is worth having because the first minute of
      // an emergency is the one where nobody is typing, and worth
      // nothing at all if reaching for it can delay the alert by a
      // millisecond. An empty body is what this endpoint has always
      // received and still handles.
      const res = await apiFetch(`/api/journeys/${journeyId}/emergency`, {
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify(pressCoords.current ?? {}),
      });
      if (!res.ok) throw new Error(`emergency POST failed: ${res.status}`);

      // SOS-FOLLOW G3 — the alert is now a state this device knows
      // about, durably. `notifyState` below still drives what this sheet
      // shows; the store is what survives the sheet closing, the screen
      // changing and the app being backgrounded, and it is what keeps
      // the follow running through all three.
      try {
        const body = (await res.json()) as { alertId?: string } | null;
        if (body?.alertId) markActive(journeyId, body.alertId);
      } catch {
        // An unreadable body costs the live follow on THIS device and
        // nothing else: the alert is sent, every channel has fired, and
        // the mount-time active-GET picks the state up on the next
        // screen. Never a failure state for the press.
      }

      setNotifyState('sent');
    } catch {
      setNotifyState('failed');
    }
  }, [journeyId, markActive]);

  const startCountdown = useCallback(() => {
    stopCountdown();
    setNotifyState('countdown');
    setRemainingMs(CANCEL_WINDOW_MS);

    // Start looking for a fix now, in the window that already exists.
    // Fire-and-forget in the strongest sense: no await anywhere on the
    // sending path, and any failure at all — denied, unavailable, slow,
    // no geolocation on this device — simply leaves it null. A cancelled
    // press records nothing, here as everywhere else: the value is only
    // ever read by the POST that a completed countdown fires.
    pressCoords.current = null;
    void geolocation
      .getCurrentPosition({ enableHighAccuracy: true, maximumAge: 30_000 })
      .then((pos) => { pressCoords.current = { lat: pos.lat, lng: pos.lng }; })
      .catch(() => { pressCoords.current = null; });
    countdown.current = setInterval(() => {
      setRemainingMs((left) => {
        const next = left - 1000;
        if (next > 0) return next;
        stopCountdown();
        void notifyPlatform();
        return 0;
      });
    }, 1000);
  }, [notifyPlatform, stopCountdown]);

  const handleConfirmed = useCallback(() => {
    setSheetOpen(true);
    startCountdown();
  }, [startCountdown]);

  /** The regret. Nothing was sent, so there is nothing to undo. */
  const cancelSend = useCallback(() => {
    stopCountdown();
    setSheetOpen(false);
    setNotifyState('countdown');
    setRemainingMs(CANCEL_WINDOW_MS);
  }, [stopCountdown]);

  // A screen that unmounts mid-countdown (the ride ends, navigation
  // happens) must not fire the alert from nowhere.
  useEffect(() => () => stopCountdown(), [stopCountdown]);

  // SOS-FOLLOW G3 — the remount truth, asked once per mount.
  //
  // Everything else that knows an emergency is live is client memory,
  // and client memory is exactly what a restart destroys. So the server
  // is asked, and its answer OUTRANKS what this device believed in both
  // directions: an ACTIVE alert restores the follow after a restart, and
  // a null clears a stale local belief that would otherwise have kept a
  // phone streaming into an emergency that ops already closed.
  //
  // A failed request changes nothing. It is not evidence that the alert
  // ended — a phone that cannot reach the server is the phone least
  // likely to be somewhere calm — so the local state stands until
  // something authoritative says otherwise.
  useEffect(() => {
    if (!journeyId) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await apiFetch(`/api/journeys/${journeyId}/emergency/active`, {
          credentials: 'include',
        });
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as { alert?: { id?: string } | null };
        if (cancelled) return;
        if (body?.alert?.id) markActive(journeyId, body.alert.id);
        else clearActive(journeyId);
      } catch {
        /* offline or refused — the local state stands. */
      }
    })();
    return () => { cancelled = true; };
  }, [journeyId, markActive, clearActive]);

  // SOS-FOLLOW G4 — the follow itself, mounted HERE rather than beside
  // each of the five pages that render this component.
  //
  // Same thing, one fewer way to get it wrong: wherever the red button
  // is, the stream is, on both roles and on rides and parcel runs alike,
  // and a sixth screen that gains an SOS button gains the follow with it
  // instead of quietly shipping without one. The hook is inert unless
  // the store says this journey holds a live alert.
  useEmergencyFollowStream(journeyId);

  return (
    <>
      <EmergencyButton onTriggerEmergency={handleConfirmed} />

      <Modal
        isOpen={sheetOpen}
        onClose={cancelSend}
        title={t('emergency.label')}
      >
        {/* Call 112 — always first, always present, in every state
            including the countdown. The delay guards notifying Bimoto;
            it has never guarded this. */}
        <a
          href="tel:112"
          className="w-full min-h-[56px] flex items-center justify-center gap-2 rounded-lg bg-[#E74C3C] text-white font-bold text-lg hover:bg-[#d44130] active:bg-[#c0392b] transition-colors"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
          </svg>
          {t('emergency.callEmergencyNumber')}
        </a>

        {notifyState === 'countdown' ? (
          // One action, as large as the call button, saying exactly what
          // is about to happen and how to stop it.
          <button
            type="button"
            onClick={cancelSend}
            data-testid="emergency-cancel-send"
            className="mt-4 w-full min-h-[56px] rounded-lg border-2 border-gray-300 bg-white text-gray-900 font-bold text-base px-3"
          >
            {t('emergency.cancelSend', { seconds: Math.ceil(remainingMs / 1000) })}
          </button>
        ) : (
          <>
            <div className="mt-4 text-sm" role="status">
              {notifyState === 'sending' && (
                <p className="text-gray-600">{t('emergency.notifying')}</p>
              )}
              {notifyState === 'sent' && (
                <p className="text-green-700 font-medium">{t('emergency.notified')}</p>
              )}
              {notifyState === 'failed' && (
                <p className="text-red-700 font-medium">{t('emergency.notifyFailed')}</p>
              )}
            </div>

            <div className="mt-4 flex gap-3">
              {notifyState === 'failed' && (
                <Button variant="secondary" fullWidth onClick={notifyPlatform}>
                  {t('emergency.retry')}
                </Button>
              )}
              <Button variant="ghost" fullWidth onClick={() => setSheetOpen(false)}>
                {t('common.close')}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
};
