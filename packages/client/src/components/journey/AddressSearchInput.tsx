import React, { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '../ui/Input';
import {
  useGeocodeSearch,
  type GeocodeSuggestion,
} from '../../hooks/useGeocodeSearch';
import { isPlaceable, type LandmarkSuggestion } from '../../lib/landmark-search';
import { GeocodingAttribution } from './GeocodingAttribution';

// GEOCODE — shared address field with live suggestions. Typing NEVER
// sets a location (that was the old hardcoded-coordinate stub); only
// picking a suggestion hands coordinates to the page. When the server
// reports geocoding unavailable (no API key) the field quietly behaves
// as a label with a subtle hint — map + GPS remain the path.
//
// LANDMARKS G3 — Kigali landmarks come first in the list, marked with a
// pin and their part of the city, because "Sonatubes" is a better answer
// than anything a street geocoder will return for it. They are also the
// only rows that survive airplane mode. A landmark the catalog could not
// place shows as "tap the map to show where this is": choosing it fills
// the name and hands the page a pin request rather than a coordinate.

export interface AddressSearchInputProps {
  value: string;
  onChangeText: (text: string) => void;
  onSelect: (choice: GeocodeSuggestion) => void;
  placeholder: string;
  label?: string;
  className?: string;
  'data-testid'?: string;
  /** BOOK-UNBLOCK G2 — fired when the server reports geocoding
   * unavailable, so the host page can promote the pick-on-map control
   * to the primary way of setting this point. */
  onUnavailable?: () => void;
  /** LANDMARKS G3 — a landmark with no verified point was chosen. The
   * page fills the name and asks for a pin. Without this handler such a
   * landmark only fills the field, which is still better than nothing. */
  onSelectUnplaceable?: (landmark: LandmarkSuggestion) => void;
}

export const AddressSearchInput: React.FC<AddressSearchInputProps> = ({
  value,
  onChangeText,
  onSelect,
  placeholder,
  label,
  className = '',
  'data-testid': testId,
  onUnavailable,
  onSelectUnplaceable,
}) => {
  const { t } = useTranslation();
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const { landmarks, suggestions, loading, unavailable, active } =
    useGeocodeSearch(open ? value : '');

  // The order is the promise: every landmark, then whatever the geocoder
  // found. Keyboard navigation walks the same single list the eye does.
  const rows: (
    | { kind: 'landmark'; item: LandmarkSuggestion }
    | { kind: 'geocode'; item: GeocodeSuggestion }
  )[] = [
    ...landmarks.map((item) => ({ kind: 'landmark' as const, item })),
    ...suggestions.map((item) => ({ kind: 'geocode' as const, item })),
  ];

  const showDropdown =
    open && active && (loading || rows.length > 0 || value.trim().length >= 3);

  useEffect(() => {
    if (unavailable) onUnavailable?.();
  }, [unavailable, onUnavailable]);

  const close = () => {
    setOpen(false);
    setActiveIndex(-1);
  };

  const selectRow = (row: (typeof rows)[number]) => {
    if (row.kind === 'geocode') {
      onSelect(row.item);
      close();
      return;
    }
    const landmark = row.item;
    if (isPlaceable(landmark)) {
      // A verified landmark is a geocoder suggestion in every way that
      // matters to the page: a name and a point.
      onSelect({ lat: landmark.point.lat, lng: landmark.point.lng, label: landmark.name });
      close();
      return;
    }
    onChangeText(landmark.name);
    onSelectUnplaceable?.(landmark);
    close();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showDropdown || rows.length === 0) {
      if (e.key === 'Escape') close();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % rows.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? rows.length - 1 : i - 1));
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      selectRow(rows[activeIndex]);
    } else if (e.key === 'Escape') {
      close();
    }
  };

  return (
    <div className={`relative ${className}`}>
      <Input
        label={label}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChangeText(e.target.value);
          setOpen(true);
          setActiveIndex(-1);
        }}
        onKeyDown={handleKeyDown}
        helperText={unavailable ? t('journey.addressSearchUnavailable') : undefined}
        role="combobox"
        aria-expanded={showDropdown}
        aria-controls={listboxId}
        aria-autocomplete="list"
        autoComplete="off"
        data-testid={testId}
      />

      {/* LANDMARKS G3 — a way back to an empty field. Retyping over a
          long landmark name on a small phone is not a way back. */}
      {value.length > 0 && (
        <button
          type="button"
          onClick={() => {
            onChangeText('');
            close();
          }}
          aria-label={t('journey.addressClear')}
          data-testid={testId ? `${testId}-clear` : undefined}
          className={`absolute right-2 ${label ? 'top-8' : 'top-1'} min-w-[44px] min-h-[44px] flex items-center justify-center text-gray-500 hover:text-gray-700`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}

      {showDropdown && (
        <>
          <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg">
          <div
            id={listboxId}
            role="listbox"
            aria-label={t('journey.addressSuggestions')}
            className="max-h-60 overflow-y-auto"
          >
            {loading && rows.length === 0 ? (
              <div className="px-3 py-3 text-sm text-gray-500">
                {t('journey.addressSearching')}
              </div>
            ) : rows.length === 0 ? (
              <div className="px-3 py-3 text-sm text-gray-500">
                {t('journey.addressNoResults')}
              </div>
            ) : (
              rows.map((row, idx) => (
                <button
                  key={
                    row.kind === 'landmark'
                      ? `lm:${row.item.name}`
                      : `${row.item.lat},${row.item.lng},${idx}`
                  }
                  type="button"
                  role="option"
                  aria-selected={idx === activeIndex}
                  onClick={() => selectRow(row)}
                  data-result-kind={row.kind}
                  data-testid={testId ? `${testId}-suggestion-${idx}` : undefined}
                  className={`w-full text-left px-3 py-2.5 min-h-[44px] text-sm border-b border-gray-100 last:border-b-0 transition-colors hover:bg-gray-50 active:bg-gray-100 ${
                    idx === activeIndex ? 'bg-gray-100' : ''
                  } ${row.kind === 'landmark' ? 'bg-[#F5F9FC]' : ''}`}
                >
                  {row.kind === 'geocode' ? (
                    <span className="text-gray-900">{row.item.label}</span>
                  ) : (
                    <span className="flex items-start gap-2">
                      <svg
                        className="w-4 h-4 mt-0.5 flex-shrink-0 text-[#1B4F72]"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                        aria-hidden="true"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      <span className="min-w-0">
                        <span className="block text-gray-900 font-medium">{row.item.name}</span>
                        {row.item.areaHint && (
                          <span className="block text-caption text-gray-500">{row.item.areaHint}</span>
                        )}
                        {!isPlaceable(row.item) && (
                          <span className="block text-caption text-[#B26B00]" data-testid="landmark-needs-pin">
                            {t('journey.landmarkNeedsPin')}
                          </span>
                        )}
                      </span>
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
          {/* PILOT-READY G3 — geocoding results are LocationIQ data;
              the free tier requires this credit link. Landmark rows are
              ours, so the credit only appears when LocationIQ answered. */}
          {suggestions.length > 0 && (
            <GeocodingAttribution className="px-3 py-1.5 border-t border-gray-100 text-right" />
          )}
          </div>
          {/* Click-away catcher — full-screen transparent layer behind
              the dropdown; tapping anywhere outside closes it. */}
          <div
            className="fixed inset-0 z-10"
            onClick={close}
            aria-hidden="true"
          />
        </>
      )}
    </div>
  );
};
