// COMPONENTS/JOURNEY/GOODS-STOP-EDITOR.TSX
//
// R3-DELIVERY — inline form for entering a single intermediate goods
// stop on a multi-stop journey. Customer fills type (drop-off /
// pick-up), location name, parcel size (SMALL / MEDIUM / LARGE), and
// optionally recipient contact info. The parent (NewJourneyPage)
// holds the stops array; this editor mutates its own internal state
// and calls onSave with the assembled LegInput.

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Language } from '@bimoto/shared';
import type {
  LegInput,
  LegType,
  ParcelCategory,
  ParcelSize,
} from '@bimoto/shared';
// PARCEL-CATEGORY — the option list and the label keys moved to
// lib/parcel-category so the send-a-package form asks the identical
// question with the identical words, rather than growing a third copy.
import {
  PARCEL_CATEGORIES,
  parcelCategoryLabelKey,
} from '../../lib/parcel-category';

interface Props {
  initialValues?: Partial<LegInput>;
  onSave: (leg: LegInput) => void;
  onCancel: () => void;
}

const GOODS_TYPES: LegType[] = ['GOODS_DROPOFF', 'GOODS_PICKUP'];
const PARCEL_SIZES: ParcelSize[] = ['SMALL', 'MEDIUM', 'LARGE'];

export const GoodsStopEditor: React.FC<Props> = ({
  initialValues,
  onSave,
  onCancel,
}) => {
  const { t } = useTranslation();
  const [type, setType] = useState<LegType>(
    (initialValues?.type as LegType | undefined) ?? 'GOODS_DROPOFF',
  );
  const [name, setName] = useState<string>(initialValues?.name ?? '');
  const [parcelSize, setParcelSize] = useState<ParcelSize>(
    (initialValues?.parcelSize as ParcelSize | undefined) ?? 'SMALL',
  );
  // R3-DELIVERY-V2 — parcel content category. null until the user
  // picks one; defaults to 'OTHER' on submit so cross-validation
  // (PARCEL_CATEGORY_ON_NON_GOODS_LEG) sees a concrete value on goods
  // legs only.
  const [parcelCategory, setParcelCategory] = useState<ParcelCategory | null>(
    (initialValues?.parcelCategory as ParcelCategory | undefined) ?? null,
  );
  const [contactName, setContactName] = useState<string>(
    initialValues?.contactName ?? '',
  );
  const [contactPhone, setContactPhone] = useState<string>(
    initialValues?.contactPhone ?? '',
  );
  // R3-DELIVERY-NOTIFICATIONS-2 — optional per-recipient language hint.
  // null means "Auto" (use the customer's User.language at SMS-compose
  // time). Customer picks one of the three Bimoto languages when they
  // know the recipient prefers a different tongue than their own.
  const [recipientLanguage, setRecipientLanguage] = useState<Language | null>(
    (initialValues?.recipientLanguage as Language | undefined) ?? null,
  );
  // Lat/lng default to Kigali centre. The customer-facing flow uses
  // text-only entry in V1; map-picker integration is deferred.
  const lat = initialValues?.lat ?? -1.95;
  const lng = initialValues?.lng ?? 30.06;

  const trimmedName = name.trim();
  const canSave = trimmedName.length > 0;

  const handleSave = () => {
    if (!canSave) return;
    const leg: LegInput = {
      type,
      lat,
      lng,
      name: trimmedName,
      parcelSize,
      // R3-DELIVERY-V2 — default to OTHER when the customer didn't
      // pick a category, so submission carries a concrete value.
      parcelCategory: parcelCategory ?? 'OTHER',
    };
    if (contactName.trim().length > 0) leg.contactName = contactName.trim();
    if (contactPhone.trim().length > 0) leg.contactPhone = contactPhone.trim();
    // R3-DELIVERY-NOTIFICATIONS-2 — persist when set; null means inherit
    // from customer's User.language at SMS-compose time.
    if (recipientLanguage) leg.recipientLanguage = recipientLanguage;
    onSave(leg);
  };

  return (
    <div
      className="rounded-lg border border-gray-300 bg-white p-3 space-y-3"
      data-testid="goods-stop-editor"
    >
      {/* Stop type selector */}
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">
          {t('delivery.stopTypeLabel')}
        </label>
        <div className="flex gap-2">
          {GOODS_TYPES.map((gt) => (
            <button
              key={gt}
              type="button"
              onClick={() => setType(gt)}
              data-testid={`stop-type-${gt}`}
              className={`min-h-[44px] px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                type === gt
                  ? 'border-[#1B4F72] bg-[#1B4F72] text-white'
                  : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
              }`}
              aria-pressed={type === gt}
            >
              {gt === 'GOODS_DROPOFF'
                ? t('delivery.stopTypeGoodsDropoff')
                : t('delivery.stopTypeGoodsPickup')}
            </button>
          ))}
        </div>
      </div>

      {/* Location name */}
      <Input
        label={t('delivery.stopNameLabel')}
        placeholder={t('delivery.stopNamePlaceholder')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        data-testid="stop-name-input"
      />

      {/* Parcel size */}
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">
          {t('delivery.parcelSizeLabel')}
        </label>
        <div className="flex flex-wrap gap-2">
          {PARCEL_SIZES.map((ps) => {
            const labelKey =
              ps === 'SMALL'
                ? 'delivery.parcelSizeSmall'
                : ps === 'MEDIUM'
                ? 'delivery.parcelSizeMedium'
                : 'delivery.parcelSizeLarge';
            return (
              <button
                key={ps}
                type="button"
                onClick={() => setParcelSize(ps)}
                data-testid={`parcel-size-${ps}`}
                className={`min-h-[44px] px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                  parcelSize === ps
                    ? 'border-[#1B4F72] bg-[#1B4F72] text-white'
                    : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
                }`}
                aria-pressed={parcelSize === ps}
              >
                {t(labelKey)}
              </button>
            );
          })}
        </div>
      </div>

      {/* R3-DELIVERY-V2 — parcel content category */}
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">
          {t('delivery.parcelCategoryLabel')}
        </label>
        <div className="flex flex-wrap gap-2">
          {PARCEL_CATEGORIES.map((pc) => (
            <button
              key={pc}
              type="button"
              onClick={() => setParcelCategory(pc)}
              data-testid={`parcel-category-${pc}`}
              className={`min-h-[44px] px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                parcelCategory === pc
                  ? 'border-[#1B4F72] bg-[#1B4F72] text-white'
                  : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
              }`}
              aria-pressed={parcelCategory === pc}
            >
              {t(parcelCategoryLabelKey(pc))}
            </button>
          ))}
        </div>
      </div>

      {/* Recipient contact (optional) */}
      <Input
        label={t('delivery.contactNameLabel')}
        value={contactName}
        onChange={(e) => setContactName(e.target.value)}
        data-testid="contact-name-input"
      />
      <Input
        label={t('delivery.contactPhoneLabel')}
        type="tel"
        value={contactPhone}
        onChange={(e) => setContactPhone(e.target.value)}
        data-testid="contact-phone-input"
      />

      {/* R3-DELIVERY-NOTIFICATIONS-2 — optional per-recipient language */}
      {contactPhone.trim().length > 0 && (
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            {t('delivery.recipientLanguageLabel')}
          </label>
          <div className="flex flex-wrap gap-2">
            {([null, Language.RW, Language.EN, Language.FR] as const).map(
              (lang) => {
                const labelKey =
                  lang === null
                    ? 'delivery.recipientLanguageAuto'
                    : lang === Language.RW
                    ? 'delivery.languageRw'
                    : lang === Language.EN
                    ? 'delivery.languageEn'
                    : 'delivery.languageFr';
                const testId = `recipient-language-${lang ?? 'auto'}`;
                const selected = recipientLanguage === lang;
                return (
                  <button
                    key={lang ?? 'auto'}
                    type="button"
                    onClick={() => setRecipientLanguage(lang)}
                    data-testid={testId}
                    className={`min-h-[44px] px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                      selected
                        ? 'border-[#1B4F72] bg-[#1B4F72] text-white'
                        : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
                    }`}
                    aria-pressed={selected}
                  >
                    {t(labelKey)}
                  </button>
                );
              },
            )}
          </div>
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <Button
          variant="secondary"
          onClick={onCancel}
          data-testid="stop-cancel"
        >
          {t('delivery.cancelStop')}
        </Button>
        <Button
          onClick={handleSave}
          disabled={!canSave}
          data-testid="stop-save"
        >
          {t('delivery.saveStop')}
        </Button>
      </div>
    </div>
  );
};

export default GoodsStopEditor;
