// DRIVER-ID v3 G3 — public "check a driver" page.
//
// The landing target for any future QR pointer object: one input, one
// live answer. Public by design (no auth) — mirrors the /welcome route
// guard-less pattern. The negative copy is deliberately uniform: it
// never distinguishes revoked / suspended / unknown numbers.

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

type CheckResult =
  | { active: true; firstName: string; vehicleType: string }
  | { active: false };

export const CheckDriverPage: React.FC = () => {
  const { t } = useTranslation();
  const [number, setNumber] = useState('');
  const [result, setResult] = useState<CheckResult | null>(null);
  const [error, setError] = useState(false);
  const [isChecking, setIsChecking] = useState(false);

  const check = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = number.trim();
    if (!trimmed) return;
    setIsChecking(true);
    setError(false);
    setResult(null);
    try {
      const res = await fetch(
        `${API_URL}/api/driver-id/${encodeURIComponent(trimmed)}`,
      );
      if (!res.ok) throw new Error(`status ${res.status}`);
      setResult(await res.json());
    } catch {
      setError(true);
    } finally {
      setIsChecking(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="max-w-md mx-auto space-y-5">
        <h1 className="text-xl font-bold text-[#1B4F72]">{t('checkDriver.title')}</h1>
        <p className="text-sm text-gray-600">{t('checkDriver.subtitle')}</p>

        <form onSubmit={check} className="space-y-3">
          <label className="block">
            <span className="text-sm text-gray-700 block mb-1">
              {t('checkDriver.inputLabel')}
            </span>
            <input
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              placeholder={t('checkDriver.inputPlaceholder')}
              className="w-full border border-gray-300 rounded-lg px-3 py-3 text-base"
              autoComplete="off"
              autoCapitalize="characters"
            />
          </label>
          <button
            type="submit"
            disabled={isChecking || !number.trim()}
            className="w-full min-h-[48px] rounded-lg bg-[#1B4F72] text-white font-semibold disabled:opacity-50"
          >
            {t('checkDriver.submit')}
          </button>
        </form>

        {error && (
          <div
            data-testid="check-driver-error"
            className="rounded-lg p-4 text-sm bg-yellow-50 text-yellow-800"
          >
            {t('checkDriver.error')}
          </div>
        )}

        {result && result.active && (
          <div
            data-testid="check-driver-active"
            className="rounded-lg p-4 bg-green-50 border border-green-200"
          >
            <p className="text-green-800 font-semibold">{t('checkDriver.active')}</p>
            <p className="text-gray-900 text-lg mt-1">{result.firstName}</p>
            <p className="text-sm text-gray-600">
              {t(`vehicle.${result.vehicleType.toLowerCase()}`)}
            </p>
          </div>
        )}

        {result && !result.active && (
          <div
            data-testid="check-driver-inactive"
            className="rounded-lg p-4 bg-gray-100 border border-gray-200 text-gray-700"
          >
            {t('checkDriver.inactive')}
          </div>
        )}
      </div>
    </div>
  );
};

export default CheckDriverPage;
