// __TESTS__/GOODS-STAGE-PERSISTENCE.TEST.TSX
//
// LOOSE-ENDS G4 — a parcel run survives the phone dying.
//
// The stage machine lived in a `useState`. A motari who photographed
// the goods, strapped them to the bike and then lost the app — battery,
// call, swipe-away — reopened it on stage one, being asked for a photo
// of a parcel already uploaded and already on his bike.
//
// The recovery ladder reads SERVER truth first (`pickupPhotoUrl` and
// `deliveryPhotoUrl`, both already on the row this page fetches on
// mount) and consults the device only for the one crossover with no
// network call behind it — the confirm tap. These tests drive the real
// page through a real remount, and the negative cases matter as much as
// the positive ones: a stale local bit must never outrank the server,
// and it must never be read for a different user.

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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

vi.mock('../hooks/useRouteDirections', () => ({ useRouteDirections: () => null }));

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
import { useAuthStore } from '../stores/auth.store';
import { useJourneyStore } from '../stores/journey.store';
import {
  clearGoodsConfirmed,
  hasConfirmedGoods,
  markGoodsConfirmed,
  recoverStep,
} from '../lib/goods-stage';

const JOURNEY_ID = 'gj-1';
const DRIVER_ID = 'driver-1';
const OTHER_DRIVER_ID = 'driver-2';

const BASE_JOURNEY = {
  id: JOURNEY_ID,
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

/** The journey row exactly as `GET /api/journeys/:id` returns it. */
function journeyWith(photos: { pickup?: boolean; delivery?: boolean }) {
  return {
    ...BASE_JOURNEY,
    pickupPhotoUrl: photos.pickup ? '/uploads/pickup-1.jpg' : null,
    deliveryPhotoUrl: photos.delivery ? '/uploads/delivery-1.jpg' : null,
  };
}

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
    <MemoryRouter initialEntries={[`/driver/goods/${JOURNEY_ID}`]}>
      <Routes>
        <Route path="/driver/goods/:id" element={<GoodsPickupPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function signInAs(id: string) {
  useAuthStore.setState({
    token: 'tok',
    user: {
      id,
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
}

const STAGE_HEADINGS = {
  pickup_photo: 'Pickup photo',
  confirm_goods: 'Check the goods',
  delivery_photo: 'Delivery photo',
  done: 'Delivery complete',
} as const;

async function expectStage(stage: keyof typeof STAGE_HEADINGS) {
  await waitFor(() =>
    expect(screen.getByText(STAGE_HEADINGS[stage])).toBeInTheDocument(),
  );
}

beforeEach(async () => {
  window.localStorage.clear();
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      emergency: {
        button: 'EMERGENCY',
        label: 'Emergency',
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
        resumed: 'Resumed where you left off',
      },
      common: { back: 'Back', cancel: 'Cancel', close: 'Close', remove: 'Remove' },
    },
    true,
    true,
  );
  await i18n.changeLanguage('en');
  signInAs(DRIVER_ID);
  useJourneyStore.setState({ activeJourney: null as never });
});

describe('recoverStep — the ladder, in isolation', () => {
  test('the server decides everything it knows', () => {
    expect(recoverStep({ pickupPhotoUrl: null, deliveryPhotoUrl: null }, false)).toBe('pickup_photo');
    expect(recoverStep({ pickupPhotoUrl: 'p', deliveryPhotoUrl: null }, false)).toBe('confirm_goods');
    expect(recoverStep({ pickupPhotoUrl: 'p', deliveryPhotoUrl: null }, true)).toBe('delivery_photo');
    expect(recoverStep({ pickupPhotoUrl: 'p', deliveryPhotoUrl: 'd' }, false)).toBe('done');
  });

  test('a delivery photo outranks the local bit in both directions', () => {
    expect(recoverStep({ pickupPhotoUrl: 'p', deliveryPhotoUrl: 'd' }, true)).toBe('done');
  });

  test('a local bit with no pickup photo on the server is ignored', () => {
    // The device says he confirmed; the server has no pickup photo, so
    // he cannot have. The server wins and he starts over.
    expect(recoverStep({ pickupPhotoUrl: null, deliveryPhotoUrl: null }, true)).toBe('pickup_photo');
  });

  test('a missing journey reads as the start, never as progress', () => {
    expect(recoverStep(null, true)).toBe('pickup_photo');
    expect(recoverStep(undefined, false)).toBe('pickup_photo');
  });
});

describe('the confirmed bit belongs to one person on one journey', () => {
  test('another user on the same phone reads nothing', () => {
    markGoodsConfirmed(JOURNEY_ID, DRIVER_ID);
    expect(hasConfirmedGoods(JOURNEY_ID, DRIVER_ID)).toBe(true);
    expect(hasConfirmedGoods(JOURNEY_ID, OTHER_DRIVER_ID)).toBe(false);
  });

  test('another journey for the same user reads nothing', () => {
    markGoodsConfirmed(JOURNEY_ID, DRIVER_ID);
    expect(hasConfirmedGoods('gj-2', DRIVER_ID)).toBe(false);
  });

  test('a missing id on either side is a no, never a crash', () => {
    expect(hasConfirmedGoods(undefined, DRIVER_ID)).toBe(false);
    expect(hasConfirmedGoods(JOURNEY_ID, undefined)).toBe(false);
    expect(() => markGoodsConfirmed(undefined, undefined)).not.toThrow();
    expect(() => clearGoodsConfirmed(undefined, undefined)).not.toThrow();
  });
});

describe('reopening the app mid-run', () => {
  test('nothing uploaded yet → stage one, and no resume notice', async () => {
    stubFetch(journeyWith({}));
    renderGoodsPage();

    await expectStage('pickup_photo');
    expect(screen.queryByTestId('goods-resumed-notice')).toBeNull();
  });

  test('pickup photo on the server → back at the check stage', async () => {
    stubFetch(journeyWith({ pickup: true }));
    renderGoodsPage();

    await expectStage('confirm_goods');
    expect(screen.getByTestId('goods-resumed-notice')).toHaveTextContent(
      'Resumed where you left off',
    );
  });

  test('pickup photo + his own confirm tap → back on the delivery leg', async () => {
    markGoodsConfirmed(JOURNEY_ID, DRIVER_ID);
    stubFetch(journeyWith({ pickup: true }));
    renderGoodsPage();

    await expectStage('delivery_photo');
    // And the map has followed him to the drop-off, as it would have
    // done had he never closed the app.
    await waitFor(() =>
      expect(screen.getByTestId('driver-nav-map').dataset.targetKind).toBe('destination'),
    );
  });

  test('delivery photo on the server → the run is over', async () => {
    stubFetch(journeyWith({ pickup: true, delivery: true }));
    renderGoodsPage();

    await expectStage('done');
  });

  test("a confirm tap from ANOTHER user does not move this one forward", async () => {
    markGoodsConfirmed(JOURNEY_ID, OTHER_DRIVER_ID);
    stubFetch(journeyWith({ pickup: true }));
    renderGoodsPage();

    // The bit on this phone is not his, so it is not read.
    await expectStage('confirm_goods');
  });

  test('a stale bit is cleared once the server holds the delivery photo', async () => {
    markGoodsConfirmed(JOURNEY_ID, DRIVER_ID);
    stubFetch(journeyWith({ pickup: true, delivery: true }));
    renderGoodsPage();

    await expectStage('done');
    await waitFor(() => expect(hasConfirmedGoods(JOURNEY_ID, DRIVER_ID)).toBe(false));
  });
});

describe('the live run writes what the reopen reads', () => {
  test('confirming records the bit; finishing clears it', async () => {
    stubFetch(journeyWith({ pickup: true }));
    renderGoodsPage();

    await expectStage('confirm_goods');
    expect(hasConfirmedGoods(JOURNEY_ID, DRIVER_ID)).toBe(false);

    fireEvent.click(screen.getByText('Confirm goods').closest('button')!);
    await expectStage('delivery_photo');
    expect(hasConfirmedGoods(JOURNEY_ID, DRIVER_ID)).toBe(true);
    // Moving forward under his own hand is not a resume.
    expect(screen.queryByTestId('goods-resumed-notice')).toBeNull();

    const inputs = document.querySelectorAll('input[type="file"]');
    const input = inputs[inputs.length - 1] as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(['x'], 'p.jpg', { type: 'image/jpeg' })] },
    });
    const save = await waitFor(() => {
      const btn = screen.getByText('Save delivery photo').closest('button') as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
      return btn;
    });
    fireEvent.click(save);

    await expectStage('done');
    await waitFor(() => expect(hasConfirmedGoods(JOURNEY_ID, DRIVER_ID)).toBe(false));
  });
});
