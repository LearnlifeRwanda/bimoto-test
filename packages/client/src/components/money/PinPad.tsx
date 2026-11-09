import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

// MONEY-PIN G3 — the pad.
//
// A DEDICATED PAD RATHER THAN AN <input type="tel">, deliberately. The
// people typing this are on a bike, often in the rain, often in gloves,
// on a phone that may be old and may be cheap. A system keyboard on such
// a phone puts ten small keys plus punctuation plus an emoji row under a
// wet thumb. This puts three big ones per row and nothing else.
//
// It also keeps the digits off the system keyboard entirely, which means
// off its prediction, its clipboard and its learned-words store. A PIN
// typed into a text field is a PIN some keyboards will remember.
//
// The value is never rendered. Filled positions show a dot; the pad
// cannot display the code even if a shoulder is watching.

export interface PinPadProps {
  /** Current value, digits only. Owned by the parent — this is controlled. */
  value: string;
  onChange: (next: string) => void;
  /** How many dots to draw — the pad's visible progress. */
  length: number;
  /**
   * Hard cap on entry, when it differs from `length`.
   *
   * The app lock uses this: it draws `length` dots (the MINIMUM code
   * length) but accepts a longer code, so the dots never tell a
   * shoulder-surfer how many digits there actually are. When omitted the
   * cap is `length` and the pad behaves as a fixed-length pad.
   */
  maxLength?: number;
  /** Fires when the last digit lands, so the parent can submit. */
  onComplete?: (value: string) => void;
  disabled?: boolean;
  /** Labels the pad for screen readers — says WHICH code is being asked for. */
  ariaLabel: string;
  testIdPrefix?: string;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

export const PinPad: React.FC<PinPadProps> = ({
  value,
  onChange,
  length,
  maxLength,
  onComplete,
  disabled = false,
  ariaLabel,
  testIdPrefix = 'pin',
}) => {
  const { t } = useTranslation();
  const cap = maxLength ?? length;

  const press = useCallback(
    (digit: string) => {
      if (disabled || value.length >= cap) return;
      const next = value + digit;
      onChange(next);
      // Fires only for a fixed-length pad. A pad with a wider cap has no
      // "last digit" to detect, so its parent submits on its own button.
      if (maxLength === undefined && next.length === length) onComplete?.(next);
    },
    [disabled, value, cap, length, maxLength, onChange, onComplete],
  );

  const backspace = useCallback(() => {
    if (disabled || value.length === 0) return;
    onChange(value.slice(0, -1));
  }, [disabled, value, onChange]);

  return (
    <div className="flex flex-col items-center gap-6" data-testid={`${testIdPrefix}-pad`}>
      {/*
        The dots. `aria-label` carries the COUNT rather than the digits,
        so a screen-reader user hears how far along they are without the
        code being spoken aloud on a bus.
      */}
      <div
        className="flex gap-3"
        role="status"
        aria-label={t('moneyPin.digitsEntered', { count: Math.min(value.length, length), total: length })}
        data-testid={`${testIdPrefix}-dots`}
      >
        {Array.from({ length }).map((_, i) => (
          <span
            key={i}
            data-testid={`${testIdPrefix}-dot-${i}`}
            data-filled={i < value.length ? 'true' : 'false'}
            className={`h-4 w-4 rounded-full border-2 ${
              i < value.length ? 'bg-[#1B4F72] border-[#1B4F72]' : 'border-gray-300'
            }`}
          />
        ))}
      </div>

      <div
        className="grid grid-cols-3 gap-3"
        role="group"
        aria-label={ariaLabel}
      >
        {KEYS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => press(k)}
            disabled={disabled || value.length >= cap}
            data-testid={`${testIdPrefix}-key-${k}`}
            // 72px targets. Well above the 44px floor, because the floor
            // assumes a steady hand indoors.
            className="h-[72px] w-[72px] rounded-full bg-gray-100 text-2xl font-semibold text-gray-900 active:bg-gray-300 disabled:opacity-40"
          >
            {k}
          </button>
        ))}
        {/* Empty cell keeps 0 centred under 8, where every phone puts it. */}
        <span aria-hidden="true" className="h-[72px] w-[72px]" />
        <button
          type="button"
          onClick={() => press('0')}
          disabled={disabled || value.length >= cap}
          data-testid={`${testIdPrefix}-key-0`}
          className="h-[72px] w-[72px] rounded-full bg-gray-100 text-2xl font-semibold text-gray-900 active:bg-gray-300 disabled:opacity-40"
        >
          0
        </button>
        <button
          type="button"
          onClick={backspace}
          disabled={disabled || value.length === 0}
          aria-label={t('moneyPin.backspace')}
          data-testid={`${testIdPrefix}-backspace`}
          className="h-[72px] w-[72px] rounded-full text-xl text-gray-700 active:bg-gray-200 disabled:opacity-40"
        >
          ⌫
        </button>
      </div>
    </div>
  );
};
