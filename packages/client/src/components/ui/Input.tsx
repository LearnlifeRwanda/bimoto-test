import React from 'react';
import { useTranslation } from 'react-i18next';

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
  error?: string;
  helperText?: string;
  suffix?: string;
  type?: 'text' | 'number' | 'tel';
}

export const Input: React.FC<InputProps> = ({
  label,
  error,
  helperText,
  suffix,
  type = 'text',
  id,
  className = '',
  ...props
}) => {
  const { t } = useTranslation();
  const inputId = id || `input-${label?.replace(/\s+/g, '-').toLowerCase() || 'field'}`;

  return (
    <div className="w-full">
      {label && (
        <label
          htmlFor={inputId}
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          {label}
        </label>
      )}
      <div className="relative">
        <input
          id={inputId}
          type={type}
          className={`
            block w-full min-h-[44px] px-3 py-2.5 rounded-lg border
            text-base bg-white
            transition-colors duration-150
            focus:outline-none focus:ring-2 focus:ring-[#1B4F72] focus:border-[#1B4F72]
            ${error ? 'border-[#E74C3C] focus:ring-[#E74C3C] focus:border-[#E74C3C]' : 'border-gray-300'}
            ${suffix ? 'pr-14' : ''}
            ${className}
          `}
          aria-invalid={!!error}
          aria-describedby={
            error ? `${inputId}-error` : helperText ? `${inputId}-helper` : undefined
          }
          {...props}
        />
        {suffix && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-medium text-gray-500 pointer-events-none">
            {suffix}
          </span>
        )}
      </div>
      {error && (
        <p id={`${inputId}-error`} className="mt-1 text-sm text-[#E74C3C]" role="alert">
          {error}
        </p>
      )}
      {helperText && !error && (
        <p id={`${inputId}-helper`} className="mt-1 text-sm text-gray-500">
          {helperText}
        </p>
      )}
    </div>
  );
};
