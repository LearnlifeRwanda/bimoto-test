import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { i18n } from './setup';

import { GeocodingAttribution } from '../components/journey/GeocodingAttribution';
import { AddressSearchInput } from '../components/journey/AddressSearchInput';
import { _resetGeocodeAvailabilityForTests } from '../hooks/useGeocodeSearch';

// PILOT-READY G3 — LocationIQ's free tier permits commercial use only
// with an attribution link in the application. The credit must render
// wherever geocoding results are shown and must genuinely be a link.

beforeEach(async () => {
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      attribution: { searchBy: 'Search by' },
      journey: {
        addressSuggestions: 'Suggestions',
        addressSearching: 'Searching…',
        addressNoResults: 'No matching places found',
        addressSearchUnavailable: 'unavailable',
      },
    },
    true,
    true,
  );
  await i18n.changeLanguage('en');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  _resetGeocodeAvailabilityForTests();
});

describe('GeocodingAttribution', () => {
  test('renders a real link pointing at LocationIQ', () => {
    render(<GeocodingAttribution />);
    const credit = screen.getByTestId('geocoding-attribution');
    expect(credit.textContent).toContain('Search by');
    const link = screen.getByRole('link', { name: 'LocationIQ' });
    expect(link.getAttribute('href')).toBe('https://locationiq.com');
  });

  test('renders inside the address-search suggestions dropdown', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            results: [{ lat: -1.95, lng: 30.06, label: 'Kimironko Market' }],
          }),
          { status: 200 },
        ),
      ),
    );

    // The input is controlled — a tiny stateful harness stands in for
    // the host page.
    const Harness: React.FC = () => {
      const [value, setValue] = React.useState('');
      return (
        <AddressSearchInput
          value={value}
          onChangeText={setValue}
          onSelect={() => {}}
          placeholder="pickup"
          data-testid="addr"
        />
      );
    };
    render(<Harness />);

    fireEvent.change(screen.getByPlaceholderText('pickup'), {
      target: { value: 'kimironko' },
    });
    await screen.findByText('Kimironko Market', {}, { timeout: 2000 });

    const credit = screen.getByTestId('geocoding-attribution');
    expect(credit).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'LocationIQ' });
    expect(link.getAttribute('href')).toBe('https://locationiq.com');
  });
});
