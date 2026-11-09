// __TESTS__/URGENT-MESSENGER-PAGE.TEST.TSX
//
// R3-T — verifies the customer-side urgent delivery surface:
//  - banner discloses the +30% premium and 30-min target window
//  - fair-price fetch sets isUrgent=true so the band already
//    includes the urgency premium
//  - submit posts type=URGENT_MESSENGER to /api/journeys
//  - navigates to the bid list after creation
//  - missing recipient blocks submit (no fetch fired)

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';
import { i18n } from './setup';

// PILOT-UX-2 G2 — the page now mounts the background map; react-leaflet
// is not jsdom-friendly, so mock it like the other map-bearing tests.
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: any) => (
    <div data-testid="map-container">{children}</div>
  ),
  TileLayer: () => null,
  Marker: ({ children }: any) => <div data-testid="marker">{children}</div>,
  Polyline: () => null,
  Popup: ({ children }: any) => <div>{children}</div>,
  useMap: () => ({ fitBounds: vi.fn() }),
  useMapEvents: () => ({}),
}));

vi.mock('leaflet', () => ({
  default: { divIcon: () => ({}) },
  divIcon: () => ({}),
}));

import { UrgentMessengerPage } from '../pages/customer/UrgentMessengerPage';
import { useAuthStore } from '../stores/auth.store';
import { _resetGeocodeAvailabilityForTests } from '../hooks/useGeocodeSearch';
import { createJourneySchema } from '@bimoto/shared';

// CREATE-FIX G2 — the submitted body must parse against the REAL shared
// schema (the server rejects anything else with a 400). Asserting on
// issues (not just success) prints the violations when it fails.
function expectSchemaConformant(body: unknown) {
  const parsed = createJourneySchema.safeParse(body);
  expect(parsed.error?.issues ?? []).toEqual([]);
  expect(parsed.success).toBe(true);
}

// GEOCODE — typing no longer sets a location; pickup/destination are
// chosen from live suggestions. Distinct coordinates per query keep
// distanceKm > 0 so the fair-price effect still fires.
const SUGGESTIONS: Record<string, { lat: number; lng: number; label: string }> = {
  'Kigali centre': { lat: -1.9441, lng: 30.0619, label: 'Kigali City Centre' },
  Nyabugogo: { lat: -1.9394, lng: 30.0442, label: 'Nyabugogo Taxi Park' },
};

// Wrap a test's fetch impl so /api/geocode/search answers with a
// suggestion and everything else falls through to the test's own mock.
function geocodeAware(
  impl: (url: string, init?: RequestInit) => Promise<unknown>,
) {
  return vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (String(url).includes('/api/geocode/search')) {
      const q = decodeURIComponent(String(url).split('q=')[1] ?? '');
      const s = SUGGESTIONS[q] ?? { lat: -1.95, lng: 30.06, label: `${q} (Kigali)` };
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ results: [s] }),
      });
    }
    return impl(url, init);
  });
}

async function pickAddress(placeholder: string, query: string) {
  fireEvent.change(screen.getByPlaceholderText(placeholder), {
    target: { value: query },
  });
  // Debounced (350 ms) — wait for the suggestion, then select it.
  const option = await screen.findByText(
    SUGGESTIONS[query]?.label ?? `${query} (Kigali)`,
    {},
    { timeout: 2000 },
  );
  fireEvent.click(option);
}

beforeEach(async () => {
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      urgent: {
        title: 'Urgent delivery',
        bannerTitle: 'Urgent delivery',
        bannerDescription:
          '+30% premium · target completion within 30 minutes after pickup',
        broadcastNotice:
          'Showing your request to all nearby drivers immediately',
        tierToggleLabel: 'Choose tier',
        tierToggleUrgent: 'Urgent · 1.3× · broadcast immediately',
        tierTogglePriority: 'Priority · 1.15× · faster cascade',
        priorityTitle: 'Priority delivery',
        priorityBannerTitle: 'Priority delivery',
        priorityBannerDescription:
          '+15% premium · faster broadcast than normal, no SLA window',
        priorityBroadcastNotice:
          'Showing your request first as the cascade expands',
        prioritySubmit: 'Send priority delivery',
        priorityPriceHint:
          'Estimated: {{min}}–{{max}} RWF (priority + vehicle premium included)',
        recipientLabel: 'Recipient name',
        recipientPlaceholder: 'Who receives the parcel?',
        recipientPhoneLabel: 'Recipient phone',
        recipientPhonePlaceholder: '+250 7XX XXX XXX',
        recipientNameRequired: 'Recipient name is required',
        recipientPhoneRequired: 'Recipient phone is required',
        descriptionLabel: 'What is being sent?',
        descriptionPlaceholder: 'Document, medication, keys…',
        packageSizeLabel: 'Package size',
        fragileLabel: 'Fragile (handle with care)',
        submit: 'Send urgent delivery',
        priceHint:
          'Estimated: {{min}}–{{max}} RWF (urgent + vehicle premium included)',
        targetWindow: 'Target: 30 min after pickup',
      },
      journey: {
        pickup: 'Pickup location',
        destination: 'Destination',
        pickupPlaceholder: 'Search pickup',
        destinationPlaceholder: 'Search destination',
        useMyLocation: 'Use my location',
        pickupRequired: 'Pickup required',
        destinationRequired: 'Destination required',
        offlineWarning: 'You are offline',
        currentLocation: 'My location',
        geoFailed: 'Could not get location',
        geoNotSupported: 'Geolocation not supported',
        createFailed: 'Could not create journey',
      },
      goods: {
        size_small: 'Small',
        size_medium: 'Medium',
        size_large: 'Large',
      },
    },
    true,
    true,
  );
  await i18n.changeLanguage('en');

  useAuthStore.setState({
    token: 'tok',
    user: { id: 'c1', role: 'CUSTOMER' } as any,
    isAuthenticated: true,
    isLoading: false,
  });
});

afterEach(() => {
  _resetGeocodeAvailabilityForTests();
});

function renderPage(initialEntry: string = '/customer/urgent') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/customer/urgent" element={<UrgentMessengerPage />} />
        <Route path="/customer/priority" element={<UrgentMessengerPage />} />
        <Route
          path="/journey/:id/bids"
          element={<div data-testid="bids-page">bids</div>}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('UrgentMessengerPage — R3-T', () => {
  test('renders the urgency banner with the +30% premium notice', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ range: null }),
    }) as any;
    renderPage();
    const banner = screen.getByTestId('urgent-banner');
    expect(banner).toBeInTheDocument();
    expect(banner.textContent).toMatch(/\+30%/);
    expect(banner.textContent).toMatch(/30 minutes/);
  });

  test('fetches /api/journeys/fair-price with journeyType=URGENT_MESSENGER on the urgent default', async () => {
    const fetchMock = geocodeAware(async () => ({
      ok: true,
      json: async () => ({ range: { min: 1000, median: 1500, max: 2000 } }),
    }));
    global.fetch = fetchMock as any;

    renderPage();

    // Select pickup + destination so distanceKm > 0 and the effect fires.
    await pickAddress('Search pickup', 'Kigali centre');
    await pickAddress('Search destination', 'Nyabugogo');

    await waitFor(() => {
      const calls = fetchMock.mock.calls.filter((c: any) =>
        String(c[0]).includes('/fair-price'),
      );
      expect(calls.length).toBeGreaterThan(0);
      expect(String(calls[0][0])).toContain('journeyType=URGENT_MESSENGER');
    });
  });

  test('submits a journey with type=URGENT_MESSENGER and navigates to bids page', async () => {
    const fetchMock = geocodeAware((url: string, init?: RequestInit) => {
      if (String(url).includes('/fair-price')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ range: { min: 1000, median: 1500, max: 2000 } }),
        } as any);
      }
      if (String(url).includes('/api/journeys') && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ id: 'j99' }),
        } as any);
      }
      return Promise.resolve({ ok: true, json: async () => ({}) } as any);
    });
    global.fetch = fetchMock as any;

    renderPage();
    await pickAddress('Search pickup', 'Kigali centre');
    await pickAddress('Search destination', 'Nyabugogo');
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('Who receives the parcel?'), {
        target: { value: 'Alice' },
      });
      fireEvent.change(screen.getByPlaceholderText('+250 7XX XXX XXX'), {
        target: { value: '+250788111111' },
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Send urgent delivery/i }));
    });

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        (c: any) =>
          String(c[0]).includes('/api/journeys') && c[1]?.method === 'POST',
      );
      expect(postCall).toBeDefined();
      const body = JSON.parse(postCall![1].body as string);
      expect(body.type).toBe('URGENT_MESSENGER');
      expect(body.recipientName).toBe('Alice');
      expect(body.recipientPhone).toBe('+250788111111');
      expect(body.wishPrice).toBe(1500);
      expectSchemaConformant(body);
    });

    await waitFor(() => {
      expect(screen.getByTestId('bids-page')).toBeInTheDocument();
    });
  });

  test('renders the price hint band when the fair-price fetch returns a range', async () => {
    global.fetch = geocodeAware(async () => ({
      ok: true,
      json: async () => ({ range: { min: 1300, median: 1800, max: 2300 } }),
    })) as any;
    renderPage();

    await pickAddress('Search pickup', 'Kigali centre');
    await pickAddress('Search destination', 'Nyabugogo');

    await waitFor(() => {
      const hint = screen.getByTestId('urgent-price-hint');
      expect(hint.textContent).toMatch(/1300/);
      expect(hint.textContent).toMatch(/2300/);
    });
  });

  test('blocks submit when recipient name is missing (no POST fired)', async () => {
    const fetchMock = geocodeAware(async () => ({
      ok: true,
      json: async () => ({ range: null }),
    }));
    global.fetch = fetchMock as any;

    renderPage();
    await pickAddress('Search pickup', 'Kigali centre');
    await pickAddress('Search destination', 'Nyabugogo');
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: /Send urgent delivery/i }),
      );
    });

    const postCall = fetchMock.mock.calls.find(
      (c: any) => c[1]?.method === 'POST',
    );
    expect(postCall).toBeUndefined();
  });

  test('exposes the urgency banner with role=status for accessibility', () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ range: null }),
    }) as any;
    renderPage();
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('data-testid', 'urgent-banner');
  });
});

describe('UrgentMessengerPage — R3-PRIORITY', () => {
  test('defaults to URGENT when arriving at /customer/urgent (no query)', () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ range: null }),
    }) as any;
    renderPage('/customer/urgent');
    const banner = screen.getByTestId('urgent-banner');
    expect(banner.getAttribute('data-tier')).toBe('URGENT_MESSENGER');
  });

  test('defaults to PRIORITY when arriving at /customer/priority', () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ range: null }),
    }) as any;
    renderPage('/customer/priority');
    const banner = screen.getByTestId('urgent-banner');
    expect(banner.getAttribute('data-tier')).toBe('PRIORITY_MESSENGER');
  });

  test('defaults to PRIORITY when arriving at /customer/urgent?tier=priority', () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ range: null }),
    }) as any;
    renderPage('/customer/urgent?tier=priority');
    const banner = screen.getByTestId('urgent-banner');
    expect(banner.getAttribute('data-tier')).toBe('PRIORITY_MESSENGER');
  });

  test('toggling to PRIORITY re-fetches fair-price with journeyType=PRIORITY_MESSENGER', async () => {
    const fetchMock = geocodeAware(async () => ({
      ok: true,
      json: async () => ({ range: { min: 1000, median: 1500, max: 2000 } }),
    }));
    global.fetch = fetchMock as any;
    renderPage('/customer/urgent');

    // Set a route so distanceKm > 0 and the effect can fire.
    await pickAddress('Search pickup', 'Kigali centre');
    await pickAddress('Search destination', 'Nyabugogo');
    await waitFor(() => {
      const urgentCall = fetchMock.mock.calls.find((c: any) =>
        String(c[0]).includes('journeyType=URGENT_MESSENGER'),
      );
      expect(urgentCall).toBeDefined();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('tier-priority'));
    });

    await waitFor(() => {
      const priorityCall = fetchMock.mock.calls.find((c: any) =>
        String(c[0]).includes('journeyType=PRIORITY_MESSENGER'),
      );
      expect(priorityCall).toBeDefined();
    });
  });

  test('submission carries journeyType=PRIORITY_MESSENGER when toggled to PRIORITY', async () => {
    const fetchMock = geocodeAware((url: string, init?: RequestInit) => {
      if (String(url).includes('/fair-price')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ range: { min: 1000, median: 1500, max: 2000 } }),
        } as any);
      }
      if (String(url).includes('/api/journeys') && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ id: 'j77' }),
        } as any);
      }
      return Promise.resolve({ ok: true, json: async () => ({}) } as any);
    });
    global.fetch = fetchMock as any;

    renderPage('/customer/priority');
    await pickAddress('Search pickup', 'Kigali centre');
    await pickAddress('Search destination', 'Nyabugogo');
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('Who receives the parcel?'), {
        target: { value: 'Bob' },
      });
      fireEvent.change(screen.getByPlaceholderText('+250 7XX XXX XXX'), {
        target: { value: '+250788222222' },
      });
    });

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: /Send priority delivery/i }),
      );
    });

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        (c: any) =>
          String(c[0]).includes('/api/journeys') && c[1]?.method === 'POST',
      );
      expect(postCall).toBeDefined();
      const body = JSON.parse(postCall![1].body as string);
      expect(body.type).toBe('PRIORITY_MESSENGER');
      expectSchemaConformant(body);
    });
  });

  test('toggling URGENT → PRIORITY → URGENT preserves form state', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ range: null }),
    }) as any;
    renderPage('/customer/urgent');

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('Who receives the parcel?'), {
        target: { value: 'Carol' },
      });
    });

    // PRIORITY
    await act(async () => {
      fireEvent.click(screen.getByTestId('tier-priority'));
    });
    expect(screen.getByTestId('urgent-banner').getAttribute('data-tier')).toBe(
      'PRIORITY_MESSENGER',
    );

    // Back to URGENT
    await act(async () => {
      fireEvent.click(screen.getByTestId('tier-urgent'));
    });
    expect(screen.getByTestId('urgent-banner').getAttribute('data-tier')).toBe(
      'URGENT_MESSENGER',
    );
    // Recipient input retained.
    expect(
      (screen.getByPlaceholderText('Who receives the parcel?') as HTMLInputElement).value,
    ).toBe('Carol');
  });
});
