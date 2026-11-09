// LIB/PARCEL-CATEGORY.TS
//
// PARCEL-CATEGORY — one list, one set of labels, one set of badge
// colours, for every screen that asks or shows what a parcel contains.
//
// WHY THIS MODULE EXISTS. The drop-a-package leg flow has asked the
// contents question since R3-DELIVERY-V2, and it grew two copies of the
// same knowledge on the way: GoodsStopEditor carried the option list
// and the label-key mapping, JourneyLegsDisplay carried the label-key
// mapping again plus the badge palette. Adding the question to the
// send-a-package form would have made a third copy, and adding the
// badge to the driver's screens a fourth and fifth. Five copies of five
// enum members is how a sixth choice arrives in one language and one
// colour and nobody notices.
//
// So the knowledge moves here once and every screen reads it: the leg
// editor, the leg display, the send-a-package form, the feed card, the
// bid screen, the pickup screen.
//
// WHAT IS DELIBERATELY NOT HERE. No new locale keys and no new enum
// members — the five choices and their fifteen translations (plus the
// three for the question itself) already existed in en/fr/rw before
// this dispatch, which is the whole point of asking the same question
// with the same words. And no relationship to `goodsFragile`, which
// stays exactly what it is: a handling boolean feeding the tier and
// handling logic, not a content category. A fragile electronics parcel
// is legitimately ELECTRONICS + goodsFragile:true.

import type { ParcelCategory } from '@bimoto/shared';

/**
 * The five choices, in the order the team named them (Faustin, 24 Aug)
 * and the order both leg-flow screens already offered them.
 */
export const PARCEL_CATEGORIES: ParcelCategory[] = [
  'FOOD',
  'ELECTRONICS',
  'DOCUMENTS',
  'FRAGILE',
  'OTHER',
];

/**
 * The i18n key for one category's label. Every key here has existed in
 * all three locales since R3-DELIVERY-V2; nothing in this dispatch adds
 * one.
 */
export function parcelCategoryLabelKey(category: ParcelCategory): string {
  switch (category) {
    case 'FOOD':
      return 'delivery.parcelCategoryFood';
    case 'ELECTRONICS':
      return 'delivery.parcelCategoryElectronics';
    case 'DOCUMENTS':
      return 'delivery.parcelCategoryDocuments';
    case 'FRAGILE':
      return 'delivery.parcelCategoryFragile';
    case 'OTHER':
      return 'delivery.parcelCategoryOther';
  }
}

/**
 * The badge palette, lifted verbatim from JourneyLegsDisplay so a
 * category reads the same colour wherever a motari meets it — on a leg
 * of a multi-stop run, on a feed card, on the bid screen, in his hands
 * at the pickup.
 */
export function parcelCategoryBadgeClass(category: ParcelCategory): string {
  switch (category) {
    case 'FOOD':
      return 'bg-emerald-100 text-emerald-800';
    case 'ELECTRONICS':
      return 'bg-blue-100 text-blue-800';
    case 'DOCUMENTS':
      return 'bg-slate-100 text-slate-700';
    case 'FRAGILE':
      return 'bg-rose-100 text-rose-800';
    case 'OTHER':
      return 'bg-gray-100 text-gray-700';
  }
}

/**
 * Is this string one of the five? The journey column is nullable and
 * the value arrives from the wire as a plain string, so every render
 * site needs the same narrowing — and a legacy NULL, or anything
 * unrecognised, must render NO badge rather than a wrong one.
 */
export function asParcelCategory(
  value: string | null | undefined,
): ParcelCategory | null {
  if (typeof value !== 'string') return null;
  return (PARCEL_CATEGORIES as string[]).includes(value)
    ? (value as ParcelCategory)
    : null;
}
