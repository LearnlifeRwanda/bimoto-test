// COMPONENTS/UI/TOAST.TSX
//
// NOTIFY G1 — one mount, a stack of toasts.
//
// This component still mounts EXACTLY ONCE, in App.tsx above the router
// (DEADWOOD G4 pinned that, and its test still holds): a second mount
// would double every announcement and every role="alert". What changed
// is what the single mount renders — a column of live toasts, newest at
// the top, instead of one slot that each new message overwrote.
//
// EACH TOAST OWNS ITS OWN TIMER. The lifetime depends on the toast's
// class (TOAST_DURATIONS: 3 s transient, 15 s notification), so a
// single component-level timeout cannot serve them; ToastItem below
// holds one timer per toast and clears it on unmount. The store stays
// pure — no timers in zustand — which is also what keeps the queue unit
// -testable without a DOM.
//
// ONE role="alert" PER TOAST, which is what a screen reader needs: two
// pieces of news are two announcements. The wrapper column carries no
// role of its own, so a single showToast() still produces exactly one
// alert — the invariant Deadwood-single-toast.test.tsx asserts.

import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  MAX_VISIBLE_TOASTS,
  TOAST_DURATIONS,
  useUIStore,
  type Toast as ToastModel,
} from '../../stores/ui.store';

const variantStyles: Record<string, string> = {
  success: 'bg-[#27AE60] text-white',
  error: 'bg-[#E74C3C] text-white',
  info: 'bg-[#1B4F72] text-white',
};

const variantIcons: Record<string, React.ReactNode> = {
  success: (
    <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  ),
  error: (
    <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  ),
  info: (
    <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20 10 10 0 000-20z" />
    </svg>
  ),
};

const ToastItem: React.FC<{ toast: ToastModel }> = ({ toast }) => {
  const { t } = useTranslation();
  const dismissToast = useUIStore((s) => s.dismissToast);

  useEffect(() => {
    const timer = setTimeout(() => dismissToast(toast.id), TOAST_DURATIONS[toast.toastClass]);
    return () => clearTimeout(timer);
  }, [toast.id, toast.toastClass, dismissToast]);

  return (
    <div
      className={`flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg animate-[slideDown_300ms_ease-out] ${variantStyles[toast.type]}`}
      role="alert"
      aria-live="assertive"
      data-toast-class={toast.toastClass}
      data-testid="toast-item"
    >
      {variantIcons[toast.type]}
      <p className="text-sm font-medium flex-1">{toast.message}</p>
      <button
        onClick={() => dismissToast(toast.id)}
        className="min-w-[44px] min-h-[44px] flex items-center justify-center -mr-2 rounded-lg hover:bg-white/20 transition-colors"
        aria-label={t('common.close')}
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
};

export const Toast: React.FC = () => {
  const { t } = useTranslation();
  const toasts = useUIStore((s) => s.toasts);

  if (toasts.length === 0) return null;

  const visible = toasts.slice(0, MAX_VISIBLE_TOASTS);
  const hidden = toasts.length - visible.length;

  return (
    <div className="fixed top-4 left-4 right-4 z-[60] flex flex-col gap-2 pointer-events-none">
      {visible.map((toast) => (
        <div key={toast.id} className="pointer-events-auto">
          <ToastItem toast={toast} />
        </div>
      ))}
      {hidden > 0 && (
        <p
          className="text-caption text-center text-gray-600 bg-white/90 rounded-lg py-1 shadow-sm pointer-events-auto"
          data-testid="toast-overflow"
        >
          {t('toast.more', { count: hidden })}
        </p>
      )}
    </div>
  );
};
