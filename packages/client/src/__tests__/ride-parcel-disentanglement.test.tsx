// __TESTS__/RIDE-PARCEL-DISENTANGLEMENT.TEST.TSX
//
// PILOT-UX-2 G5 — the customer journey fork:
//   - CustomerHomePage forks to ride (/journey/new) vs parcel
//     (/journey/goods)
//   - NewJourneyPage (the ride request) renders NO urgency-tier UI —
//     tiers are parcel/messenger concepts
//   - GoodsRequestPage renders the tier group with NORMAL selected by
//     default; priority/urgent lead to the dedicated messenger flows
//   - UrgentMessengerPage's tier toggle carries the NORMAL option back
//     to the goods flow (no one-way doors)
//   - every creation screen carries an escape hatch (APP-HEADER G2:
//     now the shell header's back control, not a page-level button)

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<any>);
  return { ...actual, useNavigate: () => mockNavigate };
});

// react-leaflet is not jsdom-friendly; all four pages mount the
// background map now.
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: any) => (
    <div data-testid="map-container">{children}</div>
  ),
  TileLayer: () => null,
  Marker: ({ children }: any) => <div data-testid="marker">{children}</div>,
  Polyline: () => null,
  Popup: ({ children }: any) => <div>{children}</div>,
  useMap: () => ({ fitBounds: vi.fn(), setView: vi.fn() }),
  useMapEvents: () => ({}),
}));

vi.mock('leaflet', () => ({
  default: { divIcon: () => ({}) },
  divIcon: () => ({}),
}));

import { CustomerHomePage } from '../pages/customer/CustomerHomePage';
import { NewJourneyPage } from '../pages/customer/NewJourneyPage';
import { GoodsRequestPage } from '../pages/customer/GoodsRequestPage';
import { UrgentMessengerPage } from '../pages/customer/UrgentMessengerPage';
import { useAuthStore } from '../stores/auth.store';
import { AppShell } from '../components/layout/AppShell';

function renderAt(ui: React.ReactElement, path = '/') {
  return render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>);
}

describe('ride/parcel disentanglement — PILOT-UX-2 G3/G4', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    useAuthStore.setState({ token: 'tok', user: { id: 'c1', role: 'CUSTOMER' } as any } as any);
    // UpcomingRidesSection (home sheet) fetches; a failed response
    // renders nothing, which is all these tests need.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test('home forks to the ride flow', () => {
    renderAt(<CustomerHomePage />);
    fireEvent.click(screen.getByTestId('home-fork-ride'));
    expect(mockNavigate).toHaveBeenCalledWith('/journey/new');
  });

  test('home forks to the parcel flow', () => {
    renderAt(<CustomerHomePage />);
    fireEvent.click(screen.getByTestId('home-fork-parcel'));
    expect(mockNavigate).toHaveBeenCalledWith('/journey/goods');
  });

  test('home carries no urgency-tier entry points', () => {
    renderAt(<CustomerHomePage />);
    expect(screen.queryByTestId('priority-delivery-entry')).toBeNull();
    expect(screen.queryByTestId('urgent-delivery-entry')).toBeNull();
  });

  test('the ride page renders no urgency-tier UI', () => {
    renderAt(<NewJourneyPage />, '/journey/new');
    expect(screen.queryByTestId('priority-delivery-entry')).toBeNull();
    expect(screen.queryByTestId('urgent-delivery-entry')).toBeNull();
    expect(screen.queryByTestId('tier-toggle')).toBeNull();
    expect(screen.queryByTestId('goods-tier-group')).toBeNull();
  });

  test('goods tier group defaults to NORMAL and links the messenger tiers', () => {
    renderAt(<GoodsRequestPage />, '/journey/goods');
    expect(screen.getByTestId('tier-normal')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('tier-priority')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByTestId('tier-urgent')).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(screen.getByTestId('tier-priority'));
    expect(mockNavigate).toHaveBeenCalledWith('/customer/priority');
    fireEvent.click(screen.getByTestId('tier-urgent'));
    expect(mockNavigate).toHaveBeenCalledWith('/customer/urgent');
  });

  test('the priority page offers NORMAL back to the goods flow (no one-way door)', () => {
    renderAt(<UrgentMessengerPage />, '/customer/priority');
    fireEvent.click(screen.getByTestId('tier-normal'));
    expect(mockNavigate).toHaveBeenCalledWith('/journey/goods');
  });

  // APP-HEADER G2 — the escape hatch is no longer a page-level
  // <BackToHome />; the shell header carries it on every non-home
  // screen, so these four are covered by the shell rather than by
  // themselves. Rendered inside AppShell here, which is how they
  // actually mount in App.tsx.
  test('every creation screen carries the escape hatch, now via the shell', () => {
    const pages: Array<[React.ReactElement, string]> = [
      [<NewJourneyPage />, '/journey/new'],
      [<GoodsRequestPage />, '/journey/goods'],
      [<UrgentMessengerPage />, '/customer/urgent'],
      [<UrgentMessengerPage />, '/customer/priority'],
    ];
    for (const [page, path] of pages) {
      mockNavigate.mockReset();
      const { unmount } = render(
        <MemoryRouter initialEntries={[path]}>
          <AppShell>{page}</AppShell>
        </MemoryRouter>,
      );
      fireEvent.click(screen.getByTestId('header-back'));
      // A single MemoryRouter entry is the cold-entry case: nothing to
      // go back to, so the control falls back to the customer home —
      // exactly where the old BackToHome went.
      expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true });
      unmount();
    }
  });
});
