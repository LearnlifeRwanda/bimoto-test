// TEAM-SAID G3 — standard and express, and express priced by bidding.
//
// Jean settled item 13: exactly two tiers, standard carrying the
// "about 1 to 3 hours" promise, and express NOT a fixed surcharge —
// priced by the same passenger-suggests / driver-bids mechanic as
// every other fare on Bimoto.
//
// So the tier reaching the wire is the easy half. The half that
// carries the decision is the negative: choosing express must change
// the price by nothing at all. That is asserted two ways here — the
// create body is identical but for the tag, and the fair-price hint
// the page shows is asked the same question either way.

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';
import { i18n } from './setup';

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: any) => <div data-testid="map-container">{children}</div>,
  TileLayer: () => null,
  Marker: ({ position, children }: any) => (
    <div data-testid="marker" data-pos={`${position[0]},${position[1]}`}>{children}</div>
  ),
  Polyline: ({ positions }: any) => <div data-testid="polyline" data-count={positions.length} />,
  Popup: ({ children }: any) => <div>{children}</div>,
  useMap: () => ({ fitBounds: vi.fn() }),
  useMapEvents: () => ({}),
}));

vi.mock('leaflet', () => ({ default: { divIcon: () => ({}) }, divIcon: () => ({}) }));

import { GoodsRequestPage } from '../pages/customer/GoodsRequestPage';
import { DeliverySpeedTag } from '../components/journey/DeliverySpeedTag';
import { useAuthStore } from '../stores/auth.store';
import { _resetGeocodeAvailabilityForTests } from '../hooks/useGeocodeSearch';
import { createJourneySchema, DeliverySpeed } from '@bimoto/shared';

function stubFetch() {
  const fetchMock = vi.fn(async (url: RequestInfo | URL, _init?: RequestInit) => {
    if (String(url).includes('/api/geocode/search')) {
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }
    if (String(url).includes('/api/journeys/fair-price')) {
      return new Response(JSON.stringify({ min: 1000, median: 1500, max: 2000 }), { status: 200 });
    }
    return new Response(JSON.stringify({ id: 'j1' }), { status: 201 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function fillRequiredFields() {
  fireEvent.change(screen.getByPlaceholderText('pickup'), { target: { value: 'sonatubes' } });
  fireEvent.click(await screen.findByText('Sonatubes'));
  fireEvent.change(screen.getByPlaceholderText('destination'), { target: { value: 'giporoso' } });
  fireEvent.click(await screen.findByText('Giporoso'));
  fireEvent.change(screen.getByPlaceholderText('what is it'), { target: { value: 'A box' } });
  fireEvent.change(screen.getByPlaceholderText('recipient name'), { target: { value: 'Alice' } });
  fireEvent.change(screen.getByPlaceholderText('recipient phone'), { target: { value: '0788000000' } });
}

async function submitAndReadBody(fetchMock: ReturnType<typeof stubFetch>) {
  fireEvent.click(screen.getByText('Send parcel'));
  const call = await waitFor(() => {
    const c = fetchMock.mock.calls.find(
      ([u, init]) => String(u).includes('/api/journeys') && (init as RequestInit)?.method === 'POST',
    );
    expect(c).toBeDefined();
    return c as unknown as [string, RequestInit];
  });
  return JSON.parse(call[1].body as string);
}

beforeEach(async () => {
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      journey: {
        pickup: 'Pickup',
        pickupPlaceholder: 'pickup',
        useMyLocation: 'Use my location',
        destination: 'Destination',
        destinationPlaceholder: 'destination',
        vehicleType: 'Vehicle type',
        wishPrice: 'Wish price',
        wishPricePlaceholder: 'wish price',
        offlineWarning: 'offline',
        addressSuggestions: 'Address suggestions',
        addressNoResults: 'none',
        addressSearching: 'searching',
        describePlaceLabel: 'Describe the place (optional)',
        describePlacePlaceholder: 'e.g. Kuwa Mudugudu',
        describePlaceHelp: 'Anything that helps the motari',
        landmarkNeedsPin: 'Tap the map to show where this is',
      },
      goods: {
        title: 'Send a parcel',
        details: 'Parcel details',
        description: 'What is it?',
        descriptionPlaceholder: 'what is it',
        size: 'Size',
        size_small: 'Small',
        size_medium: 'Medium',
        size_large: 'Large',
        fragile: 'Fragile',
        recipientName: 'Recipient name',
        recipientNamePlaceholder: 'recipient name',
        recipientPhone: 'Recipient phone',
        recipientPhonePlaceholder: 'recipient phone',
        submit: 'Send parcel',
        tierLabel: 'Tier',
        tierNormal: 'Normal',
        missingDescription: 'missing description',
      },
      urgent: { tierTogglePriority: 'Priority', tierToggleUrgent: 'Urgent' },
      vehicleTypes: { MOTO: 'Moto' },
      parcelWeight: { label: 'Weight', placeholder: 'kg', motoAlone: 'envelope only' },
      delivery: {
        // LIVE-WIRE G5 — mirrors the real en bundle, which changed with
        // Jean's item 13(c): the 1-to-3-hours promise became a
        // selectable window, so the description points at the control
        // instead of stating the band in prose.
        speedLabel: 'Delivery speed',
        speedStandard: 'Standard',
        speedStandardDesc:
          'Delivered the same day. Choose an hour window below if you need one.',
        speedExpress: 'Express',
        speedExpressDesc:
          'Faster than standard. There is no fixed extra charge — motaris bid their price.',
        standardHoursLabel: 'Deliver within (optional)',
        standardHoursAny: 'Any time',
        standardHoursN: '{{count}} h',
        standardHoursWithin: 'within {{count}} h',
        standardHoursNote:
          'This does not change the price — the motari still bids his own fare.',
      },
    },
    true,
    true,
  );
  await i18n.changeLanguage('en');
  useAuthStore.setState({ token: 'tok', user: { id: 'c1', role: 'CUSTOMER' } as any } as any);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  _resetGeocodeAvailabilityForTests();
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/journey/goods']}>
      <Routes>
        <Route path="/journey/goods" element={<GoodsRequestPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('GoodsRequestPage — two tiers, and only two', () => {
  test('offers exactly standard and express, with standard selected', () => {
    stubFetch();
    renderPage();

    // LIVE-WIRE G5 — scoped to the SPEED radiogroup rather than the
    // whole section: the section now also hosts the optional 1/2/3-hour
    // window for STANDARD, whose radios are not speed options. The
    // guard this test exists for — exactly two speeds, never three —
    // is unchanged and, if anything, sharper.
    const group = screen.getByTestId('delivery-speed-options');
    expect(group.querySelectorAll('[role="radio"]')).toHaveLength(2);
    expect(screen.getByTestId('delivery-speed-STANDARD')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('delivery-speed-EXPRESS')).toHaveAttribute('aria-checked', 'false');
  });

  test('standard carries the 1-to-3-hours promise', () => {
    stubFetch();
    renderPage();
    // LIVE-WIRE G5 — the "about 1 to 3 hours" promise became a
    // selectable window (Jean's item 13(c)), so the description now
    // points at it instead of stating the band in prose. The promise
    // itself is unchanged and is asserted on the control below.
    expect(screen.getByTestId('delivery-speed-desc')).toHaveTextContent(
      'same day',
    );
    expect(screen.getByTestId('standard-hours-1')).toBeInTheDocument();
    expect(screen.getByTestId('standard-hours-2')).toBeInTheDocument();
    expect(screen.getByTestId('standard-hours-3')).toBeInTheDocument();
  });

  test('express says the price comes from the bids, not from a surcharge', () => {
    stubFetch();
    renderPage();
    fireEvent.click(screen.getByTestId('delivery-speed-EXPRESS'));
    const desc = screen.getByTestId('delivery-speed-desc');
    expect(desc).toHaveTextContent('no fixed extra charge');
    // No percentage or multiplier is quoted anywhere in the tier copy.
    expect(desc.textContent).not.toMatch(/\d+\s*%/);
  });

  test('the default reaches the wire as STANDARD', async () => {
    const fetchMock = stubFetch();
    renderPage();
    await fillRequiredFields();

    const body = await submitAndReadBody(fetchMock);
    expect(body.deliverySpeed).toBe(DeliverySpeed.STANDARD);
    expect(createJourneySchema.safeParse(body).error?.issues ?? []).toEqual([]);
  });

  test('choosing express reaches the wire as EXPRESS', async () => {
    const fetchMock = stubFetch();
    renderPage();
    await fillRequiredFields();
    fireEvent.click(screen.getByTestId('delivery-speed-EXPRESS'));

    const body = await submitAndReadBody(fetchMock);
    expect(body.deliverySpeed).toBe(DeliverySpeed.EXPRESS);
    expect(createJourneySchema.safeParse(body).error?.issues ?? []).toEqual([]);
  });
});

describe('express adds no price', () => {
  test('the two create bodies are identical but for the tag itself', async () => {
    // A successful submit navigates away, so these are two renders.
    const fetchMock = stubFetch();
    const first = renderPage();
    await fillRequiredFields();
    const standard = await submitAndReadBody(fetchMock);
    first.unmount();

    fetchMock.mockClear();
    renderPage();
    await fillRequiredFields();
    fireEvent.click(screen.getByTestId('delivery-speed-EXPRESS'));
    const express = await submitAndReadBody(fetchMock);

    expect(standard.deliverySpeed).toBe('STANDARD');
    expect(express.deliverySpeed).toBe('EXPRESS');
    // No wishPrice, no multiplier, no surcharge field — the request
    // differs by one string and nothing else.
    //
    // OUTBOX G2 — clientRequestId names the booking ATTEMPT, not the
    // booking: it is a fresh uuid on every submit, so any two sends
    // differ by it by design. It is transport identity (the offline
    // outbox's idempotency key), never a fare input, so it is dropped
    // from both sides here. What this test guards — that express buys
    // no pricing field — is unchanged.
    const { deliverySpeed: _s, clientRequestId: _sid, ...standardRest } = standard;
    const { deliverySpeed: _e, clientRequestId: _eid, ...expressRest } = express;
    expect(expressRest).toEqual(standardRest);
  });

  test('the fair-price hint is asked the same question for either tier', async () => {
    // If express ever acquired a premium, the suggested-fare lookup is
    // where it would first show up. The tier is not one of its inputs.
    const fetchMock = stubFetch();
    renderPage();
    await fillRequiredFields();

    const before = fetchMock.mock.calls
      .filter(([u]) => String(u).includes('fair-price'))
      .map(([u]) => String(u));

    fireEvent.click(screen.getByTestId('delivery-speed-EXPRESS'));
    await waitFor(() => {
      const after = fetchMock.mock.calls
        .filter(([u]) => String(u).includes('fair-price'))
        .map(([u]) => String(u));
      // Every fair-price URL asked is one that was already being asked
      // before the tier changed — the tier is not in the query.
      for (const url of after) {
        expect(before.length === 0 || before).toContain(url);
      }
    });
  });
});

describe('DeliverySpeedTag — what the motari reads', () => {
  test('renders the tier for both values', () => {
    const { unmount } = render(<DeliverySpeedTag deliverySpeed={DeliverySpeed.EXPRESS} />);
    expect(screen.getByTestId('delivery-speed-tag')).toHaveTextContent('Express');
    expect(screen.getByTestId('delivery-speed-tag')).toHaveAttribute('data-speed', 'EXPRESS');
    unmount();

    render(<DeliverySpeedTag deliverySpeed={DeliverySpeed.STANDARD} />);
    expect(screen.getByTestId('delivery-speed-tag')).toHaveTextContent('Standard');
  });

  test('renders nothing for a parcel booked before tiers existed', () => {
    for (const value of [null, undefined, '']) {
      const { unmount } = render(<DeliverySpeedTag deliverySpeed={value} />);
      expect(screen.queryByTestId('delivery-speed-tag')).toBeNull();
      unmount();
    }
  });

  test('quotes no price of its own', () => {
    render(<DeliverySpeedTag deliverySpeed={DeliverySpeed.EXPRESS} />);
    // The tag is a label. If it ever starts rendering RWF or a
    // percentage, express has acquired a surcharge.
    const text = screen.getByTestId('delivery-speed-tag').textContent ?? '';
    expect(text).not.toMatch(/RWF|\d+\s*%/);
  });
});
