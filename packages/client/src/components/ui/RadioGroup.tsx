// R3-DRIVER-SCREENER — minimal accessible radio group. Mirrors the
// Button/Input typography (#1B4F72 focus, 44px min-height for touch).
// Kept dependency-free so it lives alongside the existing UI primitives.

import React from 'react';

export interface RadioOption {
  value: string;
  label: string;
  /** Optional caption rendered below the label (e.g. per-option help). */
  description?: string;
}

export interface RadioGroupProps {
  name: string;
  value: string | null;
  onChange: (value: string) => void;
  options: readonly RadioOption[];
  legend?: string;
  ariaLabel?: string;
  disabled?: boolean;
}

export const RadioGroup: React.FC<RadioGroupProps> = ({
  name,
  value,
  onChange,
  options,
  legend,
  ariaLabel,
  disabled = false,
}) => {
  return (
    <fieldset
      className="space-y-2"
      aria-label={ariaLabel}
      disabled={disabled}
    >
      {legend && (
        <legend className="text-base font-medium text-gray-900 mb-2">
          {legend}
        </legend>
      )}
      {options.map((opt) => {
        const id = `${name}-${opt.value}`;
        const checked = value === opt.value;
        return (
          <label
            key={opt.value}
            htmlFor={id}
            className={`
              flex items-start gap-3 min-h-[44px] px-4 py-2.5 rounded-lg
              border cursor-pointer transition-colors
              ${
                checked
                  ? 'border-[#1B4F72] bg-[#1B4F72]/5'
                  : 'border-gray-200 hover:border-gray-300'
              }
              ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
            `}
          >
            <input
              type="radio"
              id={id}
              name={name}
              value={opt.value}
              checked={checked}
              onChange={() => onChange(opt.value)}
              className="h-4 w-4 mt-1 text-[#1B4F72] focus:ring-[#1B4F72]"
              disabled={disabled}
            />
            <span className="flex flex-col">
              <span className="text-base text-gray-900">{opt.label}</span>
              {opt.description && (
                <span
                  style={{
                    fontSize: 11,
                    color: '#6c757d',
                    marginTop: 2,
                    display: 'block',
                  }}
                >
                  {opt.description}
                </span>
              )}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
};
