import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { SOS_HOLD_MS } from '../../config/sos';

// FLIGHT-RECORDER G5 — the red button grows a guard.
//
// RED-BUTTON put a 60px emergency FAB on five ride screens, fixed at the
// bottom-right of a phone held in one hand on a moto. A single tap opened
// the confirm dialog. On a bike that is a knee, a bag strap, or a hand
// steadying itself — and the confirm dialog is then one more thing to
// dismiss while riding.
//
// So the trigger becomes press-and-hold: HOLD_MS of deliberate contact,
// with a ring that fills so the person can see the commitment happening
// and let go. Releasing early cancels, silently — no toast, no "alert
// cancelled", nothing. An accidental brush should leave no trace,
// because a trace is itself a thing to deal with.
//
// What holding is NOT: a wall. A gesture that requires sustained precise
// contact excludes people who cannot produce one — a tremor, a
// prosthetic, a switch device, a screen reader driving the button from
// the keyboard. So keyboard and assistive activation take the SAME path
// they always did: Enter or Space opens the confirm immediately. Holding
// is a refinement for pointers, not a new requirement.
//
// The confirm dialog after it is unchanged. The delay that follows it
// lives in EmergencySOS, which is also where tel:112 stays one tap away
// at every step of all of this.

export interface EmergencyButtonProps {
  onTriggerEmergency: () => void;
}

/**
 * How long a deliberate press lasts.
 *
 * QUEUE-UNITY G4 — the value now comes from config/sos.ts, which reads
 * VITE_SOS_HOLD_MS at build time and defaults to 1000 ms (raised from
 * 700: the hold is one of three gates now, so it can afford more margin
 * for gloves and rain). Re-exported under its original name because
 * five test files and the ring's own geometry read it from here.
 */
export const HOLD_MS = SOS_HOLD_MS;

/** Geometry of the progress ring drawn around the button. */
const RING_RADIUS = 28;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export const EmergencyButton: React.FC<EmergencyButtonProps> = ({
  onTriggerEmergency,
}) => {
  const { t } = useTranslation();
  const [showConfirm, setShowConfirm] = useState(false);
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelHold = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    // Silently. An accidental brush leaves nothing to dismiss.
    setHolding(false);
  }, []);

  const beginHold = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setHolding(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      setHolding(false);
      setShowConfirm(true);
    }, HOLD_MS);
  }, []);

  // A component that unmounts mid-hold (the ride ends, the screen
  // changes) must not fire afterwards.
  useEffect(() => () => cancelHold(), [cancelHold]);

  const handleConfirm = () => {
    setShowConfirm(false);
    onTriggerEmergency();
  };

  // Enter and Space are the explicit, hold-free path. `repeat` is
  // ignored so holding Space down does not re-open the dialog.
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.repeat) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    cancelHold();
    setShowConfirm(true);
  };

  return (
    <>
      <button
        type="button"
        onPointerDown={beginHold}
        onPointerUp={cancelHold}
        onPointerLeave={cancelHold}
        onPointerCancel={cancelHold}
        onKeyDown={handleKeyDown}
        // A long press on a touch screen otherwise raises the selection
        // handles or the context menu over the button being held.
        onContextMenu={(e) => e.preventDefault()}
        className="fixed bottom-24 right-4 z-50 min-w-[60px] min-h-[60px] w-[60px] h-[60px] rounded-full bg-[#E74C3C] text-white font-bold text-xs shadow-lg hover:bg-[#d44130] active:bg-[#c0392b] transition-colors flex items-center justify-center select-none touch-none"
        aria-label={t('emergency.button')}
        aria-describedby="emergency-hold-hint"
        data-testid="emergency-button"
        data-holding={holding ? 'true' : 'false'}
      >
        {/* The commitment, made visible. The ring fills over HOLD_MS so
            a person who did not mean it can see it happening and let go.
            aria-hidden: the hint below is what assistive tech reads, and
            the keyboard path does not involve a hold at all. */}
        <svg
          className="absolute inset-0 w-[60px] h-[60px] -rotate-90 pointer-events-none"
          viewBox="0 0 60 60"
          aria-hidden="true"
        >
          <circle
            cx="30"
            cy="30"
            r={RING_RADIUS}
            fill="none"
            stroke="white"
            strokeWidth={holding ? 4 : 0}
            strokeLinecap="round"
            strokeDasharray={RING_CIRCUMFERENCE}
            strokeDashoffset={holding ? 0 : RING_CIRCUMFERENCE}
            // motion-reduce drops the sweep and shows the ring at once:
            // the feedback stays, the movement goes.
            className="transition-[stroke-dashoffset] ease-linear motion-reduce:transition-none"
            style={{ transitionDuration: `${HOLD_MS}ms` }}
            data-testid="emergency-hold-ring"
          />
        </svg>
        {t('emergency.label')}
      </button>

      {/* Read by assistive tech, invisible on screen: how to work the
          button both ways, so the pointer refinement never reads as the
          only way in. */}
      <span id="emergency-hold-hint" className="sr-only">
        {t('emergency.holdHint')}
      </span>

      <Modal
        isOpen={showConfirm}
        onClose={() => setShowConfirm(false)}
        title={t('emergency.confirmTitle')}
      >
        <p className="text-sm text-gray-600 mb-4">
          {t('emergency.confirmMessage')}
        </p>
        <div className="flex gap-3">
          <Button
            variant="secondary"
            fullWidth
            onClick={() => setShowConfirm(false)}
          >
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            fullWidth
            onClick={handleConfirm}
          >
            {t('emergency.confirm')}
          </Button>
        </div>
      </Modal>
    </>
  );
};
