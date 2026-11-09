// __TESTS__/PARCEL-PARITY-GOODS-DRIVER.TEST.TSX
//
// PARCEL-PARITY G2 — the motari carrying a parcel gets the map the
// motari carrying a person already has.
//
// He was never map-less for the whole run: ApproachPage is shared by
// both journey types, so he could see the way to the pickup. He lost
// the map the moment the journey went IN_PROGRESS and
// ActiveJourneyBanner sent him here — which is the leg with somebody
// else's goods strapped to the bike.
//
// This walks the real stage machine (photo → upload → confirm) rather
// than poking state, because the thing under test IS the stage machine:
// the map has to follow him from the pickup to the drop-off without
// anybody telling it to.

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';
import { i18n } from './setup';

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="map-container">{children}</div>
  ),
  TileLayer: () => <div data-testid="osm-tile-layer" />,
  Marker: () => <div data-testid="marker" />,
  Polyline: () => <div data-testid="polyline" />,
  useMap: () => ({ setView: vi.fn(), fitBounds: vi.fn(), panTo: vi.fn() }),
}));

vi.mock('leaflet', () => {
  const divIcon = (opts: { className?: string }) => ({ options: opts });
  return { default: { divIcon }, divIcon };
});

vi.mock('../hooks/useRouteDirections', () => ({
  useRouteDirections: () => null,
}));

vi.mock('../hooks/useOwnPosition', () => ({
  useOwnPosition: () => ({
    lat: -1.9536,
    lng: 30.0606,
    accuracy: 8,
    speed: null,
    heading: null,
    timestamp: 0,
  }),
}));

import { GoodsPickupPage } from '../pages/driver/GoodsPickupPage';
// QUEUE-UNITY G4 — duration from the config module.
import { SOS_CANCEL_MS as CANCEL_WINDOW_MS } from '../config/sos';
import { useAuthStore } from '../stores/auth.store';
import { useJourneyStore } from '../stores/journey.store';

// An ordinary Journey row that happens to carry goods: the two legs are
// the same pickupLat/destinationLat columns a ride uses. Nothing here is
// invented — GoodsRequestPage posts exactly these on create.
const GOODS_JOURNEY = {
  id: 'gj-1',
  type: 'GOODS',
  status: 'IN_PROGRESS',
  pickupName: 'Kimironko Market',
  destinationName: 'Nyabugogo',
  pickupLat: -1.95,
  pickupLng: 30.06,
  destinationLat: -1.9441,
  destinationLng: 30.0619,
  goodsDescription: 'One sealed box of spare parts',
  goodsSize: 'MEDIUM',
  customer: { nickname: 'Alice' },
};

function stubFetch(journey: unknown) {
  (globalThis as { fetch?: unknown }).fetch = vi.fn(async (url: unknown) => {
    if (typeof url === 'string' && url.includes('/upload/')) {
      return { ok: true, json: async () => ({ ok: true }) };
    }
    return { ok: true, json: async () => journey };
  });
}

function renderGoodsPage() {
  return render(
    <MemoryRouter initialEntries={['/driver/goods/gj-1']}>
      <Routes>
        <Route path="/driver/goods/:id" element={<GoodsPickupPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Drive the real flow one stage forward, from the photo inputs up. */
async function attachPhotoAndUpload(saveLabel: string) {
  const inputs = document.querySelectorAll('input[type="file"]');
  const input = inputs[inputs.length - 1] as HTMLInputElement;
  const file = new File(['x'], 'parcel.jpg', { type: 'image/jpeg' });
  fireEvent.change(input, { target: { files: [file] } });

  const save = await waitFor(() => {
    const btn = screen.getByText(saveLabel).closest('button') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    return btn;
  });
  fireEvent.click(save);
}

beforeEach(async () => {
  // The shared setup stubs only chat/common/vehicleTypeInfo, so the keys
  // this screen reads come from here — same pattern as
  // DriverEmergencySOS.test.tsx. Real words, so the assertions below
  // read as what the motari actually sees.
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      emergency: {
        button: 'EMERGENCY',
        label: 'Emergency',
        confirm: 'Send emergency alert to your contacts?',
        confirmTitle: 'Emergency alert',
        confirmMessage: 'Send an emergency alert to your contacts and Bimoto?',
        callEmergencyNumber: 'Call 112',
        notifying: 'Notifying Bimoto…',
        notified: 'Bimoto has been notified',
        notifyFailed: 'Could not notify Bimoto — call 112',
        retry: 'Try again',
      },
      goodsPickup: {
        takePickupPhoto: 'Pickup photo',
        uploadPickupPhoto: 'Save pickup photo',
        confirmGoods: 'Check the goods',
        confirmButton: 'Confirm goods',
        takeDeliveryPhoto: 'Delivery photo',
        uploadDeliveryPhoto: 'Save delivery photo',
        complete: 'Delivery complete',
        tapToCapture: 'Tap to take a photo',
      },
      common: { back: 'Back', cancel: 'Cancel', close: 'Close', remove: 'Remove' },
    },
    true,
    true,
  );
  await i18n.changeLanguage('en');
  useAuthStore.setState({
    token: 'tok',
    user: {
      id: 'driver-1',
      nickname: 'Driver Bob',
      role: 'DRIVER',
      language: 'en',
      idVerified: true,
      licenseVerified: true,
      completedRides: 5,
      cancellationCount: 0,
      totalRequests: 0,
    },
    isAuthenticated: true,
    isLoading: false,
  } as never);
  useJourneyStore.setState({ activeJourney: GOODS_JOURNEY as never });
  stubFetch(GOODS_JOURNEY);
});

describe('PARCEL-PARITY G2 — the map follows the parcel', () => {
  test('the pickup stage points the map at the PICKUP', async () => {
    renderGoodsPage();

    const map = await waitFor(() => screen.getByTestId('driver-nav-map'));
    expect(map.dataset.targetKind).toBe('pickup');
    expect(screen.getByTestId('map-container')).toBeInTheDocument();

    // The parcel panel that was here before is still here.
    expect(screen.getByText('One sealed box of spare parts')).toBeInTheDocument();
  });

  test('the confirm stage still points at the PICKUP — he has not left yet', async () => {
    renderGoodsPage();
    await waitFor(() => screen.getByTestId('driver-nav-map'));

    await attachPhotoAndUpload(i18n.t('goodsPickup.uploadPickupPhoto'));

    // Stage moved…
    await waitFor(() =>
      expect(screen.getByText(i18n.t('goodsPickup.confirmGoods'))).toBeInTheDocument(),
    );
    // …and the map has not, because he is standing at the pickup with
    // the parcel in his hands.
    expect(screen.getByTestId('driver-nav-map').dataset.targetKind).toBe('pickup');
  });

  test('confirming the goods swings the map to the DROP-OFF', async () => {
    renderGoodsPage();
    await waitFor(() => screen.getByTestId('driver-nav-map'));

    await attachPhotoAndUpload(i18n.t('goodsPickup.uploadPickupPhoto'));
    await waitFor(() => screen.getByText(i18n.t('goodsPickup.confirmButton')));

    fireEvent.click(
      screen.getByText(i18n.t('goodsPickup.confirmButton')).closest('button') as HTMLButtonElement,
    );

    await waitFor(() =>
      expect(screen.getByTestId('driver-nav-map').dataset.targetKind).toBe('destination'),
    );
  });

  test('the finished screen carries no map — there is nowhere left to ride', async () => {
    renderGoodsPage();
    await waitFor(() => screen.getByTestId('driver-nav-map'));

    await attachPhotoAndUpload(i18n.t('goodsPickup.uploadPickupPhoto'));
    await waitFor(() => screen.getByText(i18n.t('goodsPickup.confirmButton')));
    fireEvent.click(
      screen.getByText(i18n.t('goodsPickup.confirmButton')).closest('button') as HTMLButtonElement,
    );

    await waitFor(() =>
      expect(screen.getByTestId('driver-nav-map').dataset.targetKind).toBe('destination'),
    );
    await attachPhotoAndUpload(i18n.t('goodsPickup.uploadDeliveryPhoto'));

    await waitFor(() =>
      expect(screen.getByText(i18n.t('goodsPickup.complete'))).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('driver-nav-map')).toBeNull();
  });

  test('a parcel journey with no coordinates shows no map, not a map of nowhere', async () => {
    const noCoords = { ...GOODS_JOURNEY, pickupLat: undefined, pickupLng: undefined };
    useJourneyStore.setState({ activeJourney: noCoords as never });
    stubFetch(noCoords);

    renderGoodsPage();

    // The parcel panel still tells him what he is carrying.
    await waitFor(() =>
      expect(screen.getByText('One sealed box of spare parts')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('driver-nav-map')).toBeNull();
  });
});

/** The floating SOS, found the way every other SOS test finds it. */
const sosButton = () => screen.getByRole('button', { name: 'EMERGENCY' });

describe('PARCEL-PARITY G3 — the red button and the line to the sender', () => {
  test('the SOS is on the screen, in the floating position it holds everywhere else', async () => {
    renderGoodsPage();

    const sos = await waitFor(sosButton);
    // Out of flow, bottom right, above every layer it could meet — so
    // this mount moved nothing and nothing can cover it.
    expect(sos.className).toContain('fixed');
    expect(sos.className).toContain('bottom-24');
    expect(sos.className).toContain('right-4');
    expect(sos.className).toContain('z-50');
  });

  // FLIGHT-RECORDER G5 changed two assertions in this test, deliberately:
  // a plain click no longer reaches the confirm (the trigger is
  // press-and-hold, or Enter for keyboard and assistive activation), and
  // the POST no longer follows the confirm immediately — it follows the
  // three-second cancel window. What did NOT change, and is asserted
  // harder than before, is that 112 is on the sheet BEFORE anything has
  // been sent.
  test('reaching it offers 112 first and tells Bimoto — no goods wording needed', async () => {
    renderGoodsPage();
    await waitFor(sosButton);

    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      // The keyboard/assistive path: one press, straight to the question.
      fireEvent.keyDown(sosButton(), { key: 'Enter' });
      fireEvent.click(screen.getByText(i18n.t('emergency.confirm')));

      // 112 is here now, during the cancel window, before any request.
      expect(
        screen.getByText(i18n.t('emergency.callEmergencyNumber')).closest('a'),
      ).toHaveAttribute('href', 'tel:112');

      const emergencyCalls = () =>
        (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter(
          ([url]) => typeof url === 'string' && url.endsWith('/api/journeys/gj-1/emergency'),
        );
      expect(emergencyCalls()).toHaveLength(0);

      await act(async () => {
        vi.advanceTimersByTime(CANCEL_WINDOW_MS);
      });

      // The POST went to the unchanged participant-guarded endpoint. The
      // guard is participation, not journey type, so a parcel journey's
      // matched driver passes exactly as a ride's does.
      expect(emergencyCalls().length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  test('the SOS is on every carrying stage, not just the first', async () => {
    renderGoodsPage();
    await waitFor(sosButton);

    await attachPhotoAndUpload(i18n.t('goodsPickup.uploadPickupPhoto'));
    await waitFor(() => screen.getByText(i18n.t('goodsPickup.confirmButton')));
    expect(sosButton()).toBeInTheDocument();

    fireEvent.click(
      screen.getByText(i18n.t('goodsPickup.confirmButton')).closest('button') as HTMLButtonElement,
    );
    await waitFor(() =>
      expect(screen.getByTestId('driver-nav-map').dataset.targetKind).toBe('destination'),
    );
    expect(sosButton()).toBeInTheDocument();
  });

  test('the chat entry navigates to the journey room that already exists', async () => {
    render(
      <MemoryRouter initialEntries={['/driver/goods/gj-1']}>
        <Routes>
          <Route path="/driver/goods/:id" element={<GoodsPickupPage />} />
          <Route path="/journey/:id/chat" element={<div data-testid="chat-page-reached" />} />
        </Routes>
      </MemoryRouter>,
    );

    const entry = await waitFor(() => screen.getByTestId('chat-entry'));
    fireEvent.click(entry);

    // The room is keyed by journey id and reads nothing about journey
    // type — the parcel sender reaches this same one from MatchedPage.
    await waitFor(() =>
      expect(screen.getByTestId('chat-page-reached')).toBeInTheDocument(),
    );
  });

  test('the chat entry is there on every carrying stage and gone once delivered', async () => {
    renderGoodsPage();
    await waitFor(() => screen.getByTestId('chat-entry'));

    await attachPhotoAndUpload(i18n.t('goodsPickup.uploadPickupPhoto'));
    await waitFor(() => screen.getByText(i18n.t('goodsPickup.confirmButton')));
    expect(screen.getByTestId('chat-entry')).toBeInTheDocument();

    fireEvent.click(
      screen.getByText(i18n.t('goodsPickup.confirmButton')).closest('button') as HTMLButtonElement,
    );
    await waitFor(() =>
      expect(screen.getByTestId('driver-nav-map').dataset.targetKind).toBe('destination'),
    );
    expect(screen.getByTestId('chat-entry')).toBeInTheDocument();

    await attachPhotoAndUpload(i18n.t('goodsPickup.uploadDeliveryPhoto'));
    await waitFor(() =>
      expect(screen.getByText(i18n.t('goodsPickup.complete'))).toBeInTheDocument(),
    );
    // Delivered: the screen's one job now is to let him leave.
    expect(screen.queryByTestId('chat-entry')).toBeNull();
  });

  test('the SOS and the chat entry are separate controls, neither inside the other', async () => {
    renderGoodsPage();
    const sos = await waitFor(sosButton);
    const entry = screen.getByTestId('chat-entry');

    // The SOS is out of flow at the bottom RIGHT; the chat entry is a
    // full-width control in the sticky bar below the column.
    expect(sos.contains(entry)).toBe(false);
    expect(entry.contains(sos)).toBe(false);
  });
});
