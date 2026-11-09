import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';
import { i18n } from './setup';

// Stub useSocket to avoid opening real connections.
vi.mock('../hooks/useSocket', () => ({
  useSocket: () => ({
    socket: null,
    isConnected: false,
    joinJourneyRoom: vi.fn(),
    leaveJourneyRoom: vi.fn(),
  }),
}));

// React-leaflet mock so the map renders in jsdom.
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: any) => <div data-testid="map-container">{children}</div>,
  TileLayer: () => null,
  Marker: ({ position }: any) => (
    <div data-testid="marker" data-pos={`${position[0]},${position[1]}`} />
  ),
  Polyline: () => null,
  useMap: () => ({ fitBounds: vi.fn(), setView: vi.fn(), panTo: vi.fn() }),
}));

vi.mock('leaflet', () => ({
  default: { divIcon: () => ({}) },
  divIcon: () => ({}),
}));

// Drive useDriverLocationStream from the test to avoid real sockets.
// R3-N-3 — approachStatus/distanceMeters default to null (server
// unreachable, fallback gate is time-only).
let mockStreamState: any = {
  driverLocation: null,
  etaMinutes: null,
  etaConfidence: 'unknown',
  etaAsOf: null,
  isLive: false,
  approachStatus: null,
  distanceMeters: null,
};
vi.mock('../hooks/useDriverLocationStream', () => ({
  useDriverLocationStream: () => mockStreamState,
}));

import { MatchedPage } from '../pages/customer/MatchedPage';
import { useAuthStore } from '../stores/auth.store';
import { useJourneyStore } from '../stores/journey.store';
import { useChatStore } from '../stores/chat.store';

beforeEach(async () => {
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      driverApproach: {
        etaMinutes: '≈ {{minutes}} min away',
        etaUnknown: 'Locating driver…',
        confidenceLow: 'estimated (long range)',
        confidenceMed: 'estimated',
        confidenceHigh: 'live',
        stale: 'Driver location unavailable — last seen {{seconds}}s ago',
        driverLabel: '{{driverName}}',
        mapLabel: 'Driver approach map',
      },
      matched: {
        driver: 'Driver',
        arriving: 'Arriving',
        driverOnTheWay: 'Driver on the way',
        chat: 'Chat',
        cancelRide: 'Cancel ride',
        cancelTitle: 'Cancel ride',
        cancelReasonPrompt: 'Why are you cancelling?',
        cancelChangedPlans: 'I changed my mind',
        cancelDriverNoShow: 'Driver did not show up',
        cancelDriverLate: 'Driver is too late, cancel',
        cancelSafety: 'I have a safety concern',
        cancelled: 'Cancelled',
        cancelFailed: 'Cancel failed',
        approach: {
          silent: "Driver hasn't started moving yet",
          approaching: 'Driver is approaching',
          arrived: 'Driver has arrived',
          lost: 'Driver appears to be lost',
          etaShort: '~{{minutes}} min',
        },
      },
      common: { yes: 'Yes', no: 'No', dismiss: 'Dismiss' },
      chat: { noMessages: 'No messages yet' },
    },
    true,
    true,
  );
  await i18n.changeLanguage('en');

  useAuthStore.setState({
    token: 'tok',
    user: {
      id: 'cust',
      nickname: 'C',
      role: 'CUSTOMER',
      language: 'en',
      idVerified: true,
      licenseVerified: true,
      completedRides: 0,
      cancellationCount: 0,
      totalRequests: 0,
    },
    isAuthenticated: true,
    isLoading: false,
  });
  useJourneyStore.setState({
    activeJourney: {
      id: 'j-1',
      status: 'MATCHED',
      pickupLat: -1.95,
      pickupLng: 30.06,
      driver: { nickname: 'Driver Bob' },
    } as any,
  });
  useChatStore.setState({ messages: [], isLoading: false });

  mockStreamState = {
    driverLocation: null,
    etaMinutes: null,
    etaConfidence: 'unknown',
    etaAsOf: null,
    isLive: false,
    approachStatus: null,
    distanceMeters: null,
  };
});

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/journey/j-1/matched']}>
      <Routes>
        <Route path="/journey/:id/matched" element={<MatchedPage />} />
      </Routes>
    </MemoryRouter>,
  );

describe('MatchedPage with DriverApproachMap (R3-E)', () => {
  test('renders the customer pickup pin even before any driver-location event', async () => {
    // The page fetches the journey on mount — stub fetch to keep the
    // existing journey store value (so we don't overwrite our setup).
    const fetchMock = vi.fn(async (url: any) => {
      if (typeof url === 'string' && url.includes('/messages')) {
        return { ok: true, json: async () => [] } as any;
      }
      return {
        ok: true,
        json: async () => ({
          id: 'j-1',
          status: 'MATCHED',
          pickupLat: -1.95,
          pickupLng: 30.06,
          driver: { nickname: 'Driver Bob' },
        }),
      } as any;
    });
    (globalThis as any).fetch = fetchMock;

    renderPage();
    await waitFor(() => expect(screen.getByTestId('driver-approach-map')).toBeInTheDocument());

    const markers = screen.getAllByTestId('marker');
    expect(markers.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId('eta-text').textContent).toContain('Locating driver');
  });

});

describe('MatchedPage cancel reason picker (R3-N-1)', () => {
  // Helper: stub fetch with a journey payload returned to the component's
  // initial loader. Returns the Vitest mock so individual tests can
  // assert on the cancel POST body.
  function stubFetchWithJourney(journey: any) {
    const fetchMock = vi.fn(async (url: any, init?: any) => {
      if (typeof url === 'string' && url.includes('/messages')) {
        return { ok: true, json: async () => [] } as any;
      }
      if (typeof url === 'string' && url.includes('/cancel')) {
        return {
          ok: true,
          json: async () => ({ ...journey, status: 'CANCELLED' }),
        } as any;
      }
      return { ok: true, json: async () => journey } as any;
    });
    (globalThis as any).fetch = fetchMock;
    return fetchMock;
  }

  test('hides DRIVER_NO_SHOW button when matchedAt is recent (< 8 min)', async () => {
    const recentJourney = {
      id: 'j-1',
      status: 'MATCHED',
      pickupLat: -1.95,
      pickupLng: 30.06,
      driver: { nickname: 'Driver Bob' },
      matchedAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
      startedAt: null,
    };
    useJourneyStore.setState({ activeJourney: recentJourney as any });
    stubFetchWithJourney(recentJourney);

    render(
      <MemoryRouter initialEntries={['/journey/j-1/matched']}>
        <Routes>
          <Route path="/journey/:id/matched" element={<MatchedPage />} />
        </Routes>
      </MemoryRouter>,
    );

    // Open the cancel modal
    await waitFor(() => screen.getByText('Cancel ride'));
    act(() => {
      fireEvent.click(screen.getByText('Cancel ride'));
    });

    expect(screen.getByText('I changed my mind')).toBeInTheDocument();
    expect(screen.getByText('I have a safety concern')).toBeInTheDocument();
    expect(screen.queryByText('Driver did not show up')).not.toBeInTheDocument();
  });

  test('shows DRIVER_NO_SHOW button when matchedAt + 8min has passed AND startedAt is null', async () => {
    const oldMatch = {
      id: 'j-1',
      status: 'MATCHED',
      pickupLat: -1.95,
      pickupLng: 30.06,
      driver: { nickname: 'Driver Bob' },
      matchedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      startedAt: null,
    };
    useJourneyStore.setState({ activeJourney: oldMatch as any });
    stubFetchWithJourney(oldMatch);

    render(
      <MemoryRouter initialEntries={['/journey/j-1/matched']}>
        <Routes>
          <Route path="/journey/:id/matched" element={<MatchedPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => screen.getByText('Cancel ride'));
    act(() => {
      fireEvent.click(screen.getByText('Cancel ride'));
    });

    expect(screen.getByText('Driver did not show up')).toBeInTheDocument();
  });

  test('hides DRIVER_NO_SHOW once the journey has startedAt (driver tapped Start)', async () => {
    const startedJourney = {
      id: 'j-1',
      status: 'MATCHED',
      pickupLat: -1.95,
      pickupLng: 30.06,
      driver: { nickname: 'Driver Bob' },
      matchedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      startedAt: new Date().toISOString(),
    };
    useJourneyStore.setState({ activeJourney: startedJourney as any });
    stubFetchWithJourney(startedJourney);

    render(
      <MemoryRouter initialEntries={['/journey/j-1/matched']}>
        <Routes>
          <Route path="/journey/:id/matched" element={<MatchedPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => screen.getByText('Cancel ride'));
    act(() => {
      fireEvent.click(screen.getByText('Cancel ride'));
    });

    expect(screen.queryByText('Driver did not show up')).not.toBeInTheDocument();
  });

  test('handleCancel sends reason in the JSON body', async () => {
    const journey = {
      id: 'j-1',
      status: 'MATCHED',
      pickupLat: -1.95,
      pickupLng: 30.06,
      driver: { nickname: 'Driver Bob' },
      matchedAt: new Date(Date.now() - 60 * 1000).toISOString(),
      startedAt: null,
    };
    useJourneyStore.setState({ activeJourney: journey as any });
    const fetchMock = stubFetchWithJourney(journey);

    render(
      <MemoryRouter initialEntries={['/journey/j-1/matched']}>
        <Routes>
          <Route path="/journey/:id/matched" element={<MatchedPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => screen.getByText('Cancel ride'));
    act(() => {
      fireEvent.click(screen.getByText('Cancel ride'));
    });

    act(() => {
      fireEvent.click(screen.getByText('I changed my mind'));
    });

    await waitFor(() => {
      const cancelCall = fetchMock.mock.calls.find(
        (c: any) => typeof c[0] === 'string' && c[0].includes('/cancel'),
      );
      expect(cancelCall).toBeTruthy();
      const init = cancelCall![1] as any;
      expect(init.method).toBe('POST');
      const body = JSON.parse(init.body);
      expect(body).toEqual({ reason: 'CUSTOMER_CHANGED_MIND' });
    });
  });
});

describe('MatchedPage cancel-modal status gating (R3-N-3)', () => {
  function stubFetch(journey: any) {
    const fetchMock = vi.fn(async (url: any) => {
      if (typeof url === 'string' && url.includes('/messages')) {
        return { ok: true, json: async () => [] } as any;
      }
      if (typeof url === 'string' && url.includes('/cancel')) {
        return {
          ok: true,
          json: async () => ({ ...journey, status: 'CANCELLED' }),
        } as any;
      }
      return { ok: true, json: async () => journey } as any;
    });
    (globalThis as any).fetch = fetchMock;
    return fetchMock;
  }

  test('shows DRIVER_NO_SHOW when status=silent AND elapsed > 8min AND !startedAt', async () => {
    const journey = {
      id: 'j-1',
      status: 'MATCHED',
      pickupLat: -1.95,
      pickupLng: 30.06,
      driver: { nickname: 'Driver Bob' },
      matchedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      startedAt: null,
    };
    useJourneyStore.setState({ activeJourney: journey as any });
    stubFetch(journey);
    mockStreamState = {
      driverLocation: null,
      etaMinutes: null,
      etaConfidence: 'unknown',
      etaAsOf: null,
      isLive: false,
      approachStatus: 'silent',
      distanceMeters: null,
    };

    renderPage();
    await waitFor(() => screen.getByText('Cancel ride'));
    act(() => {
      fireEvent.click(screen.getByText('Cancel ride'));
    });

    expect(screen.getByText('Driver did not show up')).toBeInTheDocument();
    expect(
      screen.queryByText('Driver is too late, cancel'),
    ).not.toBeInTheDocument();
  });

  test('hides DRIVER_NO_SHOW when status=approaching even if elapsed > 8min', async () => {
    // Smallest-wrongness gate (§8): a visibly approaching driver
    // must not be falsely accused of not showing up.
    const journey = {
      id: 'j-1',
      status: 'MATCHED',
      pickupLat: -1.95,
      pickupLng: 30.06,
      driver: { nickname: 'Driver Bob' },
      matchedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      startedAt: null,
    };
    useJourneyStore.setState({ activeJourney: journey as any });
    stubFetch(journey);
    mockStreamState = {
      driverLocation: { lat: -1.951, lng: 30.06, asOf: new Date() },
      etaMinutes: 2,
      etaConfidence: 'high',
      etaAsOf: new Date(),
      isLive: true,
      approachStatus: 'approaching',
      distanceMeters: 320,
    };

    renderPage();
    await waitFor(() => screen.getByText('Cancel ride'));
    act(() => {
      fireEvent.click(screen.getByText('Cancel ride'));
    });

    expect(screen.queryByText('Driver did not show up')).not.toBeInTheDocument();
  });

  test('shows DRIVER_LATE when status=approaching AND elapsed > 12min', async () => {
    const journey = {
      id: 'j-1',
      status: 'MATCHED',
      pickupLat: -1.95,
      pickupLng: 30.06,
      driver: { nickname: 'Driver Bob' },
      matchedAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
      startedAt: null,
    };
    useJourneyStore.setState({ activeJourney: journey as any });
    stubFetch(journey);
    mockStreamState = {
      driverLocation: { lat: -1.951, lng: 30.06, asOf: new Date() },
      etaMinutes: 2,
      etaConfidence: 'high',
      etaAsOf: new Date(),
      isLive: true,
      approachStatus: 'approaching',
      distanceMeters: 250,
    };

    renderPage();
    await waitFor(() => screen.getByText('Cancel ride'));
    act(() => {
      fireEvent.click(screen.getByText('Cancel ride'));
    });

    expect(screen.getByText('Driver is too late, cancel')).toBeInTheDocument();
    expect(screen.queryByText('Driver did not show up')).not.toBeInTheDocument();
  });

  test('hides DRIVER_LATE when status=silent (DRIVER_NO_SHOW preferred)', async () => {
    const journey = {
      id: 'j-1',
      status: 'MATCHED',
      pickupLat: -1.95,
      pickupLng: 30.06,
      driver: { nickname: 'Driver Bob' },
      matchedAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
      startedAt: null,
    };
    useJourneyStore.setState({ activeJourney: journey as any });
    stubFetch(journey);
    mockStreamState = {
      driverLocation: null,
      etaMinutes: null,
      etaConfidence: 'unknown',
      etaAsOf: null,
      isLive: false,
      approachStatus: 'silent',
      distanceMeters: null,
    };

    renderPage();
    await waitFor(() => screen.getByText('Cancel ride'));
    act(() => {
      fireEvent.click(screen.getByText('Cancel ride'));
    });

    expect(screen.getByText('Driver did not show up')).toBeInTheDocument();
    expect(
      screen.queryByText('Driver is too late, cancel'),
    ).not.toBeInTheDocument();
  });
});

describe('MatchedPage redispatch banner (R3-N-4)', () => {
  test('renders Find another driver when journey is CANCELLED with cancelReason=DRIVER_NO_SHOW', async () => {
    const cancelled = {
      id: 'j-1',
      status: 'CANCELLED',
      cancelReason: 'DRIVER_NO_SHOW',
      pickupLat: -1.95,
      pickupLng: 30.06,
      driver: { nickname: 'Driver Bob' },
    };
    useJourneyStore.setState({ activeJourney: cancelled as any });
    i18n.addResourceBundle(
      'en',
      'translation',
      {
        matched: {
          driverDidntShow: "Your driver didn't show up.",
          findAnotherDriver: 'Find another driver',
        },
      },
      true,
      true,
    );
    (globalThis as any).fetch = vi.fn(async (url: any) => {
      if (typeof url === 'string' && url.includes('/messages')) {
        return { ok: true, json: async () => [] } as any;
      }
      return { ok: true, json: async () => cancelled } as any;
    });

    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId('no-show-banner')).toBeInTheDocument(),
    );
    expect(screen.getByText('Find another driver')).toBeInTheDocument();
  });
});

describe('MatchedPage with DriverApproachMap (R3-E) — etaPill', () => {
  test('updates ETA pill once a driver location arrives', async () => {
    (globalThis as any).fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        id: 'j-1',
        status: 'MATCHED',
        pickupLat: -1.95,
        pickupLng: 30.06,
        driver: { nickname: 'Driver Bob' },
      }),
    }));

    mockStreamState = {
      driverLocation: { lat: -1.951, lng: 30.062, asOf: new Date() },
      etaMinutes: 3,
      etaConfidence: 'med',
      etaAsOf: new Date(),
      isLive: true,
    };

    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId('eta-text').textContent).toContain('3'),
    );
    expect(screen.getByText('estimated')).toBeInTheDocument();
  });
});

// GAP-CLOSE G1 — the commission-transparency crash.
//
// PAGE-mounted (MONEY-PIN #203's placement rule): the real MatchedPage,
// mounted at its real route, is what crashed in the field 9 times. A
// component test over the block alone would not have caught it, because
// the block is not a component.
//
// The shape that crashed is the shape the server DESIGNED for this
// screen: EXPORT-AND-LEDGER G4's toCustomerSafeCommission hands the
// customer { bidPrice, customerTier, customerSavings, feeWaiverApplied }
// and omits totalCommissionAmount / totalCommissionRate / driverPayout —
// the three the block called .toLocaleString() / * 100 on.
describe('MatchedPage commission transparency (GAP-CLOSE G1)', () => {
  beforeEach(async () => {
    i18n.addResourceBundle(
      'en',
      'translation',
      {
        transparency: {
          feeWaivedLine: 'Platform fee waived ({{amount}} RWF)',
          platformFeeAmount: 'Platform fee {{amount}} RWF ({{rate}}%)',
          driverReceives: 'Driver receives {{amount}} RWF',
          tierSavings: '{{tier}} tier saved you {{amount}} RWF',
          customerTierLine: 'Your tier: {{tier}}',
          customerFeeWaived: 'Platform fee waived during the pilot.',
        },
      },
      true,
      true,
    );
    await i18n.changeLanguage('en');
  });

  function mountWithJourney(journey: any) {
    const fetchMock = vi.fn(async (url: any) => {
      if (typeof url === 'string' && url.includes('/messages')) {
        return { ok: true, json: async () => [] } as any;
      }
      return { ok: true, json: async () => journey } as any;
    });
    (globalThis as any).fetch = fetchMock;
    useJourneyStore.setState({ activeJourney: journey as any });
    return renderPage();
  }

  const BASE = {
    id: 'j-1',
    status: 'MATCHED',
    pickupLat: -1.95,
    pickupLng: 30.06,
    agreedPrice: 3000,
    driver: { nickname: 'Driver Bob' },
  };

  test('journey with NO commissionBreakdown: screen renders, no crash, block absent', async () => {
    mountWithJourney(BASE);

    // The screen is up — the crash took the whole route down, so the
    // driver card rendering at all is the assertion that matters.
    // 'Driver Bob' shows in the driver card AND the approach strip — the
    // count is not the point, the page being up at all is.
    await waitFor(() =>
      expect(screen.getAllByText('Driver Bob').length).toBeGreaterThan(0),
    );
    expect(screen.queryByTestId('matched-transparency')).not.toBeInTheDocument();
    expect(screen.queryByTestId('matched-transparency-customer')).not.toBeInTheDocument();
    // The customer's own fare is still on the screen.
    expect(screen.getByText(/3,000/)).toBeInTheDocument();
  });

  // CLEAN-SWEEP G1 — GAP-CLOSE skipped this block WHOLE for a customer,
  // which also took away customerSavings, customerTier and
  // feeWaiverApplied: three of the four fields the server DELIBERATELY
  // GIVES the passenger. The savings line came off the one screen that
  // showed it. Founder ruling (25 Aug): the redacted shape renders a
  // CUSTOMER VARIANT of those four fields and nothing else.
  test('REDACTED (customer-safe) breakdown: the customer variant renders — tier and savings, no motari net', async () => {
    // Verbatim the CustomerSafeCommissionView shape.
    mountWithJourney({
      ...BASE,
      commissionBreakdown: {
        bidPrice: 3000,
        customerTier: 'GOLD',
        customerSavings: 150,
        feeWaiverApplied: false,
      },
    });

    const variant = await screen.findByTestId('matched-transparency-customer');
    expect(variant.textContent).toContain('GOLD');
    expect(variant.textContent).toContain('150');

    // The FULL block, which is the one that reads the driver's side, is
    // not on the screen at all.
    expect(screen.queryByTestId('matched-transparency')).not.toBeInTheDocument();

    // No waiver line: feeWaiverApplied is false on this fixture.
    expect(screen.queryByTestId('matched-fee-waived')).not.toBeInTheDocument();

    // THE REDACTION BOUNDARY (#202). Nothing on the whole page from which
    // the motari's net can be reconstructed: not the commission total, not
    // the rate, not the payout — and no zero standing in for them.
    const page = document.body.textContent ?? '';
    expect(page).not.toContain('Driver receives');
    expect(page).not.toContain('Platform fee waived (');
    expect(page).not.toMatch(/Platform fee [\d,]+ RWF/);
    // The variant's whole content, exactly: the two lines the four
    // customer-safe fields can honestly produce and nothing else. A
    // fabricated `0` for a redacted field would show up here.
    expect(variant.textContent).toBe('Your tier: GOLDGOLD tier saved you 150 RWF');
  });

  test('REDACTED breakdown under a waiver: the waiver line appears, still with no amount', async () => {
    mountWithJourney({
      ...BASE,
      commissionBreakdown: {
        bidPrice: 3000,
        customerTier: 'GOLD',
        customerSavings: 0,
        feeWaiverApplied: true,
      },
    });

    const variant = await screen.findByTestId('matched-transparency-customer');
    expect(screen.getByTestId('matched-fee-waived').textContent).toBe(
      'Platform fee waived during the pilot.',
    );
    // customerSavings is 0 — the savings line is omitted rather than
    // printed as "saved you 0".
    expect(variant.textContent).not.toContain('tier saved you');
    expect(screen.queryByTestId('matched-transparency')).not.toBeInTheDocument();
    // The waived AMOUNT is totalCommissionAmount, which this shape does
    // not carry and this line must never quote.
    expect(document.body.textContent ?? '').not.toContain('normally');
  });

  test('FULL breakdown: block present, with the real numbers', async () => {
    mountWithJourney({
      ...BASE,
      commissionBreakdown: {
        bidPrice: 3000,
        driverTier: 'SILVER',
        driverCommissionRate: 0.1,
        customerTier: 'GOLD',
        customerCommissionRate: 0.05,
        totalCommissionRate: 0.15,
        totalCommissionAmount: 450,
        driverPayout: 2550,
        customerSavings: 150,
        driverSavings: 0,
        feeWaiverApplied: false,
      },
    });

    await waitFor(() =>
      expect(screen.getByTestId('matched-transparency')).toBeInTheDocument(),
    );
    const block = screen.getByTestId('matched-transparency');
    expect(block.textContent).toContain('450');
    expect(block.textContent).toContain('15.0');
    expect(block.textContent).toContain('2,550');
    expect(block.textContent).toContain('GOLD');
    // The two arms are mutually exclusive: a full breakdown renders the
    // full block and never also the customer variant.
    expect(screen.queryByTestId('matched-transparency-customer')).not.toBeInTheDocument();
  });

  test('breakdown present but the money fields missing: block absent, no fabricated zeros', async () => {
    mountWithJourney({
      ...BASE,
      commissionBreakdown: { bidPrice: 3000, customerTier: 'GOLD' },
    });

    // 'Driver Bob' shows in the driver card AND the approach strip — the
    // count is not the point, the page being up at all is.
    await waitFor(() =>
      expect(screen.getAllByText('Driver Bob').length).toBeGreaterThan(0),
    );
    expect(screen.queryByTestId('matched-transparency')).not.toBeInTheDocument();
    // Not customer-safe either: customerSavings is missing, so there is
    // nothing honest for the variant to say and it stays off too.
    expect(screen.queryByTestId('matched-transparency-customer')).not.toBeInTheDocument();
    expect(screen.queryByText(/0 RWF/)).not.toBeInTheDocument();
  });
});
