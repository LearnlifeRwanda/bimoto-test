// ANY-VEHICLE G2 — honest per-kind context, before any bid exists.
//
// Choosing "Any vehicle" means the customer has declined to guess which
// machine suits the trip. The screen owes them enough to make that
// choice comfortably — what each kind typically costs, and roughly how
// long it takes — without pretending to know either precisely.
//
// So what is proved here is as much about restraint as about content:
// the block appears ONLY for Any, every duration is a range, the whole
// block is labelled an estimate, there is no second price input (one
// wish price across all kinds — founder ruling, 24 Aug), and the
// existing single-number hint is untouched when a vehicle IS chosen.

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { i18n } from './setup';
import { FairPriceHint } from '../components/journey/FairPriceHint';
import { COMPARABLE_VEHICLE_TYPES, VehicleType } from '@bimoto/shared';

const PICKUP = { lat: -1.9536, lng: 30.0606 };
// ~4.4 km east — a real cross-town trip, not a rounding artefact.
const DESTINATION = { lat: -1.9536, lng: 30.1006 };

const MEDIAN = 2000;

function stubFairPrice() {
  const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
    void url;
    return new Response(JSON.stringify({ range: { min: 1500, median: MEDIAN, max: 2600 } }), {
      status: 200,
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      journey: {
        fair_price: 'Suggested {{price}} RWF',
        useSuggestedPrice: 'Use this price',
        estimateLabel: 'Estimates — the real price is what a motari offers',
        estimateTypicalPrice: 'about {{price}} RWF',
        estimateDurationRange: '{{min}}–{{max}} min',
      },
      vehicles: { bike: 'Bicycle', ebike: 'E-bike', moto: 'Moto', emoto: 'E-moto' },
    },
    true,
    true,
  );
  await i18n.changeLanguage('en');
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderHint(props: Partial<React.ComponentProps<typeof FairPriceHint>> = {}) {
  return render(
    <FairPriceHint
      pickup={PICKUP}
      destination={DESTINATION}
      journeyType="PASSENGER"
      vehicleType={null}
      anyVehicle
      onUsePrice={vi.fn()}
      {...props}
    />,
  );
}

describe('the per-kind block renders for Any', () => {
  test('one row per comparable vehicle kind', async () => {
    stubFairPrice();
    renderHint();

    await waitFor(() => expect(screen.getByTestId('fair-price-hint-any')).toBeInTheDocument());
    for (const vt of COMPARABLE_VEHICLE_TYPES) {
      expect(screen.getByTestId(`fair-price-any-row-${vt}`)).toBeInTheDocument();
    }
    // ...and the single-number hint is NOT also on screen.
    expect(screen.queryByTestId('fair-price-hint')).toBeNull();
  });

  test('the whole block is labelled an estimate', async () => {
    stubFairPrice();
    renderHint();
    await waitFor(() =>
      expect(
        screen.getByText('Estimates — the real price is what a motari offers'),
      ).toBeInTheDocument(),
    );
  });

  test('each duration is a RANGE, never a single number', async () => {
    stubFairPrice();
    renderHint();

    await waitFor(() => expect(screen.getByTestId('fair-price-hint-any')).toBeInTheDocument());
    for (const vt of COMPARABLE_VEHICLE_TYPES) {
      const row = screen.getByTestId(`fair-price-any-row-${vt}`);
      // "12–34 min" — two figures joined by an en dash. A single
      // number here would be a promise the platform cannot keep.
      expect(row.textContent).toMatch(/\d+–\d+ min/);
    }
  });

  test('prices are the base band scaled by the shared ladder', async () => {
    stubFairPrice();
    renderHint();

    await waitFor(() => expect(screen.getByTestId('fair-price-hint-any')).toBeInTheDocument());
    // MOTO is the 1.0 rung, BIKE the 0.7 rung.
    expect(screen.getByTestId(`fair-price-any-row-${VehicleType.MOTO}`).textContent).toContain(
      'about 2,000 RWF',
    );
    expect(screen.getByTestId(`fair-price-any-row-${VehicleType.BIKE}`).textContent).toContain(
      'about 1,400 RWF',
    );
  });

  test('a bicycle is shown as costing less and taking longer than a moto', async () => {
    stubFairPrice();
    renderHint();

    await waitFor(() => expect(screen.getByTestId('fair-price-hint-any')).toBeInTheDocument());
    const read = (vt: string) => {
      const text = screen.getByTestId(`fair-price-any-row-${vt}`).textContent ?? '';
      const price = Number((text.match(/about ([\d,]+) RWF/)?.[1] ?? '0').replace(/,/g, ''));
      const maxMin = Number(text.match(/\d+–(\d+) min/)?.[1] ?? '0');
      return { price, maxMin };
    };
    const bike = read(VehicleType.BIKE);
    const moto = read(VehicleType.MOTO);
    expect(bike.price).toBeLessThan(moto.price);
    expect(bike.maxMin).toBeGreaterThan(moto.maxMin);
  });
});

describe('one wish price, and the fetch stays vehicle-agnostic', () => {
  test('no vehicleType is sent to the fair-price endpoint', async () => {
    const fetchMock = stubFairPrice();
    renderHint();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).not.toContain('vehicleType');
  });

  test('"use this price" still fills from the vehicle-agnostic base', async () => {
    stubFairPrice();
    const onUsePrice = vi.fn();
    renderHint({ onUsePrice });

    await waitFor(() => expect(screen.getByTestId('use-fair-price')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('use-fair-price'));
    expect(onUsePrice).toHaveBeenCalledWith(MEDIAN);
  });

  test('there is exactly one price control — no per-kind price input', async () => {
    stubFairPrice();
    renderHint();

    await waitFor(() => expect(screen.getByTestId('fair-price-hint-any')).toBeInTheDocument());
    expect(screen.getAllByTestId('use-fair-price')).toHaveLength(1);
    expect(
      screen.getByTestId('fair-price-hint-any').querySelectorAll('input'),
    ).toHaveLength(0);
  });
});

describe('and NOT otherwise — the chosen-vehicle hint is untouched', () => {
  test('a chosen vehicle renders the single-number hint, no per-kind block', async () => {
    stubFairPrice();
    renderHint({ vehicleType: VehicleType.MOTO, anyVehicle: false });

    await waitFor(() => expect(screen.getByTestId('fair-price-hint')).toBeInTheDocument());
    expect(screen.queryByTestId('fair-price-hint-any')).toBeNull();
    expect(screen.getByText('Suggested 2,000 RWF')).toBeInTheDocument();
  });

  test('a chosen vehicle still sends its vehicleType to the endpoint', async () => {
    const fetchMock = stubFairPrice();
    renderHint({ vehicleType: VehicleType.E_MOTO, anyVehicle: false });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls[0][0])).toContain('vehicleType=E_MOTO');
  });

  test('sparse data still hides everything, either way', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ range: null }), { status: 200 })),
    );
    const { container } = renderHint();
    await waitFor(() => expect(container.querySelector('[data-testid]')).toBeNull());
  });
});
