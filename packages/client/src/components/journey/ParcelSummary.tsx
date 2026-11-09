// COMPONENTS/JOURNEY/PARCEL-SUMMARY.TSX
//
// PARCEL-VISIBLE G4 — what actually prices a parcel run, on the card where
// the motari decides whether to open it.
//
// Every field here has been on the wire since the parcel form shipped
// (`goodsSizeCategory`, `goodsWeightKg`, `goodsFragile`, `goodsDescription`)
// and none of them reached the driver's feed card. Nothing new is collected
// or transmitted to render this — the payload already had it.
//
// Every part is independently optional, because every one of these columns
// is nullable and a parcel booked before a given field existed simply has no
// answer. Absent is rendered as absent, never as a zero or a default.
//
// The people who go WITH a parcel — the recipient's name and phone — are
// deliberately not here and are no longer even on the wire pre-match
// (PARCEL-VISIBLE G2). A motari prices a job from the cargo, not from who is
// waiting for it.

import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  asParcelCategory,
  parcelCategoryBadgeClass,
  parcelCategoryLabelKey,
} from '../../lib/parcel-category';

interface Props {
  sizeCategory?: string | null;
  weightKg?: number | null;
  fragile?: boolean | null;
  description?: string | null;
  /**
   * PARCEL-CATEGORY — what the sender said the parcel CONTAINS. Content,
   * not identity: it joins the set a bidding motari can see before he is
   * matched, alongside the size and the description he already gets. The
   * recipient's name and phone are the floor and stay off the wire.
   *
   * Nullable like every other field here, and for the sharper reason:
   * every parcel booked before the question existed has no answer, and
   * an unanswered parcel must render NO badge rather than a wrong one.
   */
  category?: string | null;
  /** Description snippets are trimmed so one long line cannot eat the card. */
  descriptionMaxChars?: number;
}

export const ParcelSummary: React.FC<Props> = ({
  sizeCategory,
  weightKg,
  fragile,
  description,
  category,
  descriptionMaxChars = 60,
}) => {
  const { t } = useTranslation();

  // A legacy NULL, and anything the client does not recognise, narrows
  // to null and renders nothing.
  const parcelCategory = asParcelCategory(category);

  const trimmedDescription = description?.trim() || null;
  const snippet =
    trimmedDescription && trimmedDescription.length > descriptionMaxChars
      ? `${trimmedDescription.slice(0, descriptionMaxChars).trimEnd()}…`
      : trimmedDescription;

  const hasAnything =
    !!sizeCategory ||
    typeof weightKg === 'number' ||
    !!fragile ||
    !!snippet ||
    !!parcelCategory;
  if (!hasAnything) return null;

  return (
    <div className="mb-2" data-testid="parcel-summary">
      <div className="flex items-center gap-2 text-caption text-gray-600 flex-wrap">
        {sizeCategory && (
          <span
            data-testid="parcel-size"
            className="bg-gray-100 px-2 py-1 rounded"
          >
            {t('goods.size')}: {t(`goods.size_${sizeCategory.toLowerCase()}`)}
          </span>
        )}
        {typeof weightKg === 'number' && (
          <span
            data-testid="parcel-weight"
            className="bg-gray-100 px-2 py-1 rounded"
          >
            {t('parcel.weightKg', { weight: weightKg })}
          </span>
        )}
        {parcelCategory && (
          <span
            data-testid="parcel-category"
            data-category={parcelCategory}
            className={`parcel-category-badge px-2 py-1 rounded font-medium ${parcelCategoryBadgeClass(
              parcelCategory,
            )}`}
          >
            {t(parcelCategoryLabelKey(parcelCategory))}
          </span>
        )}
        {fragile && (
          <span
            data-testid="parcel-fragile"
            className="bg-amber-100 text-amber-900 px-2 py-1 rounded font-medium"
          >
            {t('goods.fragile')}
          </span>
        )}
      </div>
      {snippet && (
        <p
          data-testid="parcel-description"
          className="mt-1 text-caption text-gray-500 truncate"
        >
          {snippet}
        </p>
      )}
    </div>
  );
};

export default ParcelSummary;
