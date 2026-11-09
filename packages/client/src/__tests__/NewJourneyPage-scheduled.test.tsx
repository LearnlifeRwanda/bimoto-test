// SCHED-UI G6 — NewJourneyPage booking-mode segmented control:
//  - "Leave now" is the default and the submit body carries no
//    bookingMode/scheduledFor
//  - "Schedule" reveals the datetime picker
//  - too-soon pickup time blocks the submit client-side
//  - a valid pickup time posts bookingMode SCHEDULED + ISO scheduledFor
//    (plus the schema-conformant field names) and lands on the
//    scheduled state screen
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';
import { i18n } from './setup';

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: any) => <div data-testid="map-container">{children}</div>,
  TileLayer: () => null,
  Marker: ({ children }: any) => <div data-testid="marker">{children}</div>,
  Polyline: () => null,
  Popup: ({ children }: any) => <div>{children}</div>,
  useMap: () => ({ fitBounds: vi.fn() }),
  useMapEvents: () => ({}),
}));
vi.mock('leaflet', () => ({ default: { divIcon: () => ({}) }, divIcon: () => ({}) }));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<any>);
  return { ...actual, useNavigate: () => mockNavigate };
});

import { NewJourneyPage } from '../pages/customer/NewJourneyPage';
import { useAuthStore } from '../stores/auth.store';
import { _resetGeocodeAvailabilityForTests } from '../hooks/useGeocodeSearch';
import { toDatetimeLocalValue } from '../lib/scheduled';
import { createJourneySchema } from '@bimoto/shared';

// CREATE-FIX G2 — the submitted body must parse against the REAL shared
// schema (the server rejects anything else with a 400). Asserting on
// issues (not just success) prints the violations when it fails.
function expectSchemaConformant(body: unknown) {
  const parsed = createJourneySchema.safeParse(body);
  expect(parsed.error?.issues ?? []).toEqual([]);
  expect(parsed.success).toBe(true);
}

const SUGGESTION = { lat: -1.9536, lng: 30.0606, label: 'Kimironko Market, Kigali' };

beforeEach(async () => {
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      journey: {
        pickupPlaceholder: 'pickup',
        destinationPlaceholder: 'destination',
        findDrivers: 'Find drivers',
      },
      scheduled: {
        leaveNow: 'Leave now',
        scheduleLater: 'Schedule',
        submit: 'Schedule ride',
        pickupTimeLabel: 'Pickup time',
      },
      errors: {
        scheduledForTooSoon: 'too soon',
        scheduledForRequired: 'time required',
      },
    },
    true,
    true,
  );
  await i18n.changeLanguage('en');
  mockNavigate.mockReset();
  useAuthStore.setState({ token: 'tok', user: { id: 'c1', role: 'CUSTOMER' } as any } as any);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  _resetGeocodeAvailabilityForTests();
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/journey/new']}>
      <Routes>
        <Route path="/journey/new" element={<NewJourneyPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function stubFetch(journeyResponse: any = { id: 'j1', status: 'SCHEDULED' }) {
  const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
    const u = String(url);
    if (u.includes('/api/geocode/search')) {
      return new Response(JSON.stringify({ results: [SUGGESTION] }), { status: 200 });
    }
    if (u.includes('/api/scheduled-rides/customer')) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    return new Response(JSON.stringify(journeyResponse), { status: 201 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function pickRoute() {
  fireEvent.change(screen.getByPlaceholderText('pickup'), {
    target: { value: 'Kimironko market' },
  });
  fireEvent.click((await screen.findAllByText(SUGGESTION.label, {}, { timeout: 2000 }))[0]);
  fireEvent.change(screen.getByPlaceholderText('destination'), {
    target: { value: 'Kimironko market' },
  });
  fireEvent.click((await screen.findAllByText(SUGGESTION.label, {}, { timeout: 2000 }))[0]);
}

function journeyPostBody(fetchMock: ReturnType<typeof vi.fn>) {
  const call = fetchMock.mock.calls.find(
    ([u, init]: any[]) => String(u).endsWith('/api/journeys') && init?.method === 'POST',
  );
  return call ? JSON.parse((call[1] as any).body) : undefined;
}

describe('NewJourneyPage — scheduled booking', () => {
  test('Leave now is the default: no picker, submit body unchanged', async () => {
    const fetchMock = stubFetch({ id: 'j1', status: 'REQUESTED' });
    renderPage();

    expect(screen.getByTestId('booking-mode-now')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByTestId('scheduled-for-input')).toBeNull();

    await pickRoute();
    fireEvent.click(screen.getByText('Find drivers'));
    await waitFor(() => expect(journeyPostBody(fetchMock)).toBeDefined());

    const body = journeyPostBody(fetchMock);
    expect(body.bookingMode).toBeUndefined();
    expect(body.scheduledFor).toBeUndefined();
    expect(body.type).toBe('PASSENGER');
    expect(body.pickupName).toBe(SUGGESTION.label);
    expect(body.destinationName).toBe(SUGGESTION.label);
    expectSchemaConformant(body);
    expect(mockNavigate).toHaveBeenCalledWith('/journey/j1/bids', { replace: true });
  });

  test('Schedule reveals the datetime picker', () => {
    stubFetch();
    renderPage();
    fireEvent.click(screen.getByTestId('booking-mode-schedule'));
    expect(screen.getByTestId('scheduled-for-input')).toBeInTheDocument();
    expect(screen.getByTestId('booking-mode-schedule')).toHaveAttribute('aria-pressed', 'true');
  });

  test('too-soon pickup time blocks the submit client-side', async () => {
    const fetchMock = stubFetch();
    renderPage();
    await pickRoute();

    fireEvent.click(screen.getByTestId('booking-mode-schedule'));
    fireEvent.change(screen.getByTestId('scheduled-for-input'), {
      target: { value: toDatetimeLocalValue(new Date(Date.now() + 10 * 60 * 1000)) },
    });
    fireEvent.click(screen.getByText('Schedule ride'));

    await screen.findByTestId('scheduled-error');
    expect(screen.getByTestId('scheduled-error').textContent).toBe('too soon');
    expect(journeyPostBody(fetchMock)).toBeUndefined();
  });

  test('empty pickup time is rejected as required', async () => {
    const fetchMock = stubFetch();
    renderPage();
    await pickRoute();

    fireEvent.click(screen.getByTestId('booking-mode-schedule'));
    fireEvent.click(screen.getByText('Schedule ride'));

    await screen.findByTestId('scheduled-error');
    expect(screen.getByTestId('scheduled-error').textContent).toBe('time required');
    expect(journeyPostBody(fetchMock)).toBeUndefined();
  });

  test('valid pickup time posts SCHEDULED + ISO scheduledFor and lands on the state screen', async () => {
    const fetchMock = stubFetch({ id: 'j9', status: 'SCHEDULED' });
    renderPage();
    await pickRoute();

    const localValue = toDatetimeLocalValue(new Date(Date.now() + 2 * 60 * 60 * 1000));
    fireEvent.click(screen.getByTestId('booking-mode-schedule'));
    fireEvent.change(screen.getByTestId('scheduled-for-input'), {
      target: { value: localValue },
    });
    fireEvent.click(screen.getByText('Schedule ride'));

    await waitFor(() => expect(journeyPostBody(fetchMock)).toBeDefined());
    const body = journeyPostBody(fetchMock);
    expect(body.bookingMode).toBe('SCHEDULED');
    expect(body.scheduledFor).toBe(new Date(localValue).toISOString());
    // Schema-conformant names ride along on the SCHEDULED branch only.
    expect(body.type).toBe('PASSENGER');
    expect(body.pickupName).toBe(SUGGESTION.label);
    expect(body.destinationName).toBe(SUGGESTION.label);
    expectSchemaConformant(body);

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('/journey/j9/scheduled', { replace: true }),
    );
  });
});
