// COMPONENTS/MAP/BOTTOM-SHEET.TSX
//
// PILOT-UX-2 G2 — the sliding sheet over the background map. Two
// snap states: 'collapsed' (map dominant, a peek of content) and
// 'expanded' (form dominant, map visible above). Deliberately simple
// and robust — CSS transforms + raw touch handlers on the drag handle,
// no physics, no new dependency. Tapping the handle toggles the state
// (also the keyboard/desktop path); dragging past the threshold snaps.
//
// The sheet sits at bottom-16 so the BottomNav (fixed bottom-0 z-40,
// h-16) always stays visible and tappable above it.

import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export type SheetState = 'collapsed' | 'expanded';

export interface BottomSheetProps {
  state: SheetState;
  onStateChange: (state: SheetState) => void;
  /** Pixels of sheet visible when collapsed. */
  collapsedHeight?: number;
  children: React.ReactNode;
}

// Finger travel (px) before a drag counts as a state change.
const DRAG_THRESHOLD_PX = 60;

export const BottomSheet: React.FC<BottomSheetProps> = ({
  state,
  onStateChange,
  collapsedHeight = 220,
  children,
}) => {
  const { t } = useTranslation();
  const [dragOffset, setDragOffset] = useState<number | null>(null);
  const touchStartY = useRef(0);
  const expanded = state === 'expanded';

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
    setDragOffset(0);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const delta = e.touches[0].clientY - touchStartY.current;
    // The sheet only moves in the direction that has somewhere to go:
    // downward from expanded, upward from collapsed.
    setDragOffset(expanded ? Math.max(0, delta) : Math.min(0, delta));
  };

  const handleTouchEnd = () => {
    const delta = dragOffset ?? 0;
    setDragOffset(null);
    if (delta <= -DRAG_THRESHOLD_PX) onStateChange('expanded');
    else if (delta >= DRAG_THRESHOLD_PX) onStateChange('collapsed');
  };

  // Resting position, plus the live finger offset while dragging.
  const baseTransform = expanded ? '0px' : `calc(100% - ${collapsedHeight}px)`;
  const transform =
    dragOffset === null
      ? `translateY(${baseTransform})`
      : `translateY(calc(${baseTransform} + ${dragOffset}px))`;

  return (
    <div
      data-testid="bottom-sheet"
      data-sheet-state={state}
      className="fixed inset-x-0 bottom-16 z-30 mx-auto max-w-lg h-[calc(100dvh-9rem)] rounded-t-2xl bg-white shadow-[0_-4px_20px_rgba(0,0,0,0.15)] flex flex-col"
      style={{
        transform,
        transition: dragOffset === null ? 'transform 200ms ease-out' : 'none',
        touchAction: 'none',
      }}
    >
      <button
        type="button"
        data-testid="sheet-handle"
        aria-expanded={expanded}
        aria-label={t('sheet.dragHandle')}
        onClick={() => onStateChange(expanded ? 'collapsed' : 'expanded')}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className="w-full flex-none pt-2.5 pb-2 flex justify-center cursor-grab"
      >
        <span className="block w-10 h-1.5 rounded-full bg-gray-300" />
      </button>
      <div
        className={`flex-1 min-h-0 ${expanded ? 'overflow-y-auto' : 'overflow-hidden'}`}
        style={{ touchAction: 'pan-y' }}
      >
        {children}
      </div>
    </div>
  );
};

export default BottomSheet;
