// PILOT-UX G3 — the customer-facing vehicle lists offer the REAL
// VehicleType enum (BIKE, MOTO, E_MOTO, E_BIKE) and never the stale
// CAR/BICYCLE/VAN placeholders, which the server rejects and which
// hid the electric options from customers entirely. The value each
// option submits must parse as a valid VehicleType.
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { i18n } from './setup';

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: any) => <div>{children}</div>,
  TileLayer: () => null,
  Marker: ({ children }: any) => <div>{children}</div>,
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
import { SettingsPage } from '../pages/shared/SettingsPage';
import { useAuthStore } from '../stores/auth.store';
import { VehicleType } from '@bimoto/shared';

const REAL_LABELS = ['Bicycle Taxi', 'Moto Taxi', 'E-Moto Taxi', 'E-Bike Taxi'];
const PHANTOM_LABELS = ['Car', 'Van', 'vehicleTypes.CAR', 'vehicleTypes.VAN', 'vehicleTypes.BICYCLE'];

beforeEach(async () => {
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      vehicles: {
        bike: 'Bicycle Taxi',
        moto: 'Moto Taxi',
        emoto: 'E-Moto Taxi',
        ebike: 'E-Bike Taxi',
      },
      journey: { vehicleType: 'Vehicle type' },
      register: { vehicleType: 'Vehicle type' },
      settings: {
        title: 'Settings',
        language: 'Language',
        vehicleInfo: 'Vehicle info',
        saveVehicle: 'Save vehicle',
        vehicleSaved: 'Vehicle saved',
        saveFailed: 'Save failed',
        logout: 'Log out',
        emergencyContacts: 'Emergency contacts',
      },
    },
    true,
    true,
  );
  await i18n.changeLanguage('en');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ vehicleType: 'E_MOTO' }), { status: 200 })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function expectRealOptionsOnly() {
  for (const label of REAL_LABELS) {
    expect(screen.getByText(label)).toBeInTheDocument();
  }
  for (const label of PHANTOM_LABELS) {
    expect(screen.queryByText(label)).not.toBeInTheDocument();
  }
}

describe('NewJourneyPage vehicle options', () => {
  test('offers exactly the real VehicleType enum, no CAR/VAN/BICYCLE', () => {
    useAuthStore.setState({ token: 'tok', user: { id: 'c1', role: 'CUSTOMER' } as any } as any);
    render(
      <MemoryRouter>
        <NewJourneyPage />
      </MemoryRouter>,
    );
    expectRealOptionsOnly();
  });
});

describe('SettingsPage driver vehicle options', () => {
  function renderAsDriver() {
    useAuthStore.setState({
      token: 'tok',
      user: {
        id: 'd1',
        role: 'DRIVER',
        driverProfile: { vehicleType: 'MOTO', registrationPlate: 'RA 123 A', vehicleDescription: 'Red' },
      } as any,
    } as any);
    return render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );
  }

  test('offers exactly the real VehicleType enum, no CAR/VAN/BICYCLE', () => {
    renderAsDriver();
    expectRealOptionsOnly();
  });

  test('saving an E_MOTO selection submits a valid VehicleType value', async () => {
    renderAsDriver();
    fireEvent.click(screen.getByText('E-Moto Taxi'));
    fireEvent.click(screen.getByText('Save vehicle'));

    await waitFor(() => {
      const call = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
        ([u, init]: any[]) => String(u).includes('/driver-profile') && init?.method === 'PUT',
      );
      expect(call).toBeDefined();
      const body = JSON.parse((call![1] as any).body);
      expect(Object.values(VehicleType)).toContain(body.vehicleType);
      expect(body.vehicleType).toBe('E_MOTO');
    });
  });
});
