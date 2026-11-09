import React from 'react';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../stores/ui.store';
import { useAuthStore } from '../../stores/auth.store';

// SOCKET-FIX G4 — blocking notice for the server-pushed account-frozen
// event. Deliberately NOT the shared Modal: that component's backdrop
// click and close affordances would let the user dismiss without the
// logout. Safe mid-ride by design: the notice renders first and stays;
// the logout (via the auth store's existing path — push deregistration,
// refresh-token clearing) happens only when the user acknowledges.

export const AccountFrozenNotice: React.FC = () => {
  const { t } = useTranslation();
  const accountFrozen = useUIStore((s) => s.accountFrozen);
  const setAccountFrozen = useUIStore((s) => s.setAccountFrozen);
  const logout = useAuthStore((s) => s.logout);

  if (!accountFrozen) return null;

  const acknowledge = () => {
    logout();
    setAccountFrozen(false);
  };

  return (
    <div
      data-testid="account-frozen-notice"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="account-frozen-title"
      className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center px-6"
    >
      <div className="bg-white rounded-xl shadow-lg p-6 max-w-sm w-full text-center">
        <h2 id="account-frozen-title" className="text-lg font-semibold text-gray-900 mb-2">
          {t('account.frozenTitle')}
        </h2>
        <p className="text-sm text-gray-600 mb-5">{t('account.frozenBody')}</p>
        <button
          data-testid="account-frozen-ack"
          onClick={acknowledge}
          className="min-h-[44px] w-full rounded-lg bg-[#1B4F72] text-white font-semibold hover:bg-[#163f5c] transition-colors"
        >
          {t('common.ok')}
        </button>
      </div>
    </div>
  );
};
