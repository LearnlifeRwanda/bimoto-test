import React from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '../ui/Input';

// LANDMARKS G4 — "describe the place".
//
// The landmark catalog covers the places a public map knows about. It does
// not cover the house past the Zion Temple turnoff, and it never will. So
// the passenger gets a line to say it in their own words, and those words
// travel with the request to the motari's screen.
//
// Optional, capped at the 200 characters the schema and the column allow,
// and invisible in its effects when left empty: nothing renders anywhere
// downstream for a journey that has nothing to say.

export const PLACE_DESCRIPTION_MAX = 200;

export interface PlaceDescriptionInputProps {
  target: 'pickup' | 'destination';
  value: string;
  onChange: (text: string) => void;
}

export const PlaceDescriptionInput: React.FC<PlaceDescriptionInputProps> = ({
  target,
  value,
  onChange,
}) => {
  const { t } = useTranslation();
  return (
    <Input
      label={t('journey.describePlaceLabel')}
      placeholder={t('journey.describePlacePlaceholder')}
      helperText={t('journey.describePlaceHelp')}
      value={value}
      maxLength={PLACE_DESCRIPTION_MAX}
      onChange={(e) => onChange(e.target.value.slice(0, PLACE_DESCRIPTION_MAX))}
      data-testid={`${target}-description-input`}
      className="mt-2"
    />
  );
};

export default PlaceDescriptionInput;
