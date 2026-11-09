import React from 'react';
import { useTranslation } from 'react-i18next';
import { Spinner } from './Spinner';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'success' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  fullWidth?: boolean;
  children: React.ReactNode;
}

const variantClasses: Record<string, string> = {
  primary: 'bg-[#1B4F72] text-white hover:bg-[#164060] active:bg-[#123550]',
  secondary: 'bg-white text-[#1B4F72] border border-[#1B4F72] hover:bg-gray-50 active:bg-gray-100',
  // PILOT-READY G1 — white label text needs 4.5:1: the ramps start one
  // step darker in the same brand hue (#E74C3C → 3.82:1, #27AE60 → 2.77:1
  // both failed WCAG AA in daylight).
  danger: 'bg-[#C0392B] text-white hover:bg-[#A93226] active:bg-[#922B21]',
  success: 'bg-[#1E8449] text-white hover:bg-[#196F3D] active:bg-[#145A32]',
  ghost: 'bg-transparent text-[#1B4F72] hover:bg-gray-100 active:bg-gray-200',
};

const sizeClasses: Record<string, string> = {
  sm: 'min-h-[44px] px-3 py-2 text-secondary',
  md: 'min-h-[44px] px-4 py-2.5 text-body',
  lg: 'min-h-[52px] px-6 py-3 text-heading',
};

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  loading = false,
  fullWidth = false,
  disabled,
  children,
  className = '',
  ...props
}) => {
  const { t } = useTranslation();

  return (
    <button
      disabled={disabled || loading}
      className={`
        inline-flex items-center justify-center rounded-lg font-medium
        transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-[#1B4F72] focus:ring-offset-2
        disabled:opacity-50 disabled:cursor-not-allowed
        ${variantClasses[variant]}
        ${sizeClasses[size]}
        ${fullWidth ? 'w-full' : ''}
        ${className}
      `}
      aria-busy={loading}
      aria-label={loading ? t('common.loading') : undefined}
      {...props}
    >
      {loading && (
        <Spinner size="sm" className="mr-2" />
      )}
      {children}
    </button>
  );
};
