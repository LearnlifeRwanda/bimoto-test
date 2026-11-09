// BIKE-GATE G4 — client surfaces are vehicle-aware, driven by the
// shared compliance matrix.
//
// RegisterPage: the plate field renders (and is validated) only for
// vehicle types with registrationRequired; a bicycle driver registers
// without one. DriverVerificationPage: the person-identifier input is
// always present (jacket-number label for plate/RURA-free types), while
// license/cooperative/insurance stay compliance-conditional.
// AdminVerifications: requirement copy derives from the driver's
// vehicle type, and a failed approve surfaces the gate's missing list.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { i18n } from './setup';

import { RegisterPage } from '../pages/auth/RegisterPage';
import { DriverVerificationPage } from '../pages/onboarding/DriverVerificationPage';
import AdminVerifications from '../pages/admin/AdminVerifications';
import { useAuthStore } from '../stores/auth.store';
import { useUIStore } from '../stores/ui.store';

beforeEach(async () => {
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      register: {
        title: 'Create account',
        subtitle: 'Tell us about you',
        nickname: 'Nickname',
        nicknamePlaceholder: 'e.g. Jean',
        roleLabel: 'I am a…',
        roleCustomer: 'Customer',
        roleDriver: 'Driver',
        roleBoth: 'Both',
        language: 'Language',
        vehicleInfo: 'Vehicle info',
        vehicleType: 'Vehicle type',
        plate: 'Registration plate',
        platePlaceholder: 'RAC 123A',
        plateRequired: 'Plate is required',
        vehicleDescription: 'Vehicle description',
        vehicleDescriptionPlaceholder: 'Color, model…',
        createAccount: 'Create account',
        success: 'Welcome!',
        nicknameRequired: 'Nickname is required',
        roleRequired: 'Role is required',
        updateFailed: 'Update failed',
        driverProfileFailed: 'Driver profile failed',
      },
      vehicles: {
        bike: 'Bicycle Taxi',
        moto: 'Moto Taxi',
        emoto: 'E-Moto Taxi',
        ebike: 'E-Bike Taxi',
        bikeRegistrationHint: 'No documents required for bicycle taxis.',
        motoRegistrationHint: 'Moto-taxi drivers need documents.',
        emotoRegistrationHint: 'E-moto drivers need documents.',
        ebikeRegistrationHint: 'E-bike taxis are a new category.',
      },
      verification: {
        title: 'Driver Verification',
        statusPending: 'Verification pending',
        licenseNumber: 'Driving License Number (Category {{category}})',
        ruraNumber: 'RURA Transport Authorization Number',
        driverNumber: 'Bimoto driver number (jacket number)',
        driverNumberHint: 'The number on your Bimoto jacket, e.g. BM-1234',
        cooperative: 'Cooperative Name',
        cooperativeHint: 'Select your cooperative',
        insurance: 'I confirm my vehicle has valid third-party insurance',
        uploadLicense: 'Upload License Photo',
        uploadRura: 'Upload RURA Authorization',
        uploadInsurance: 'Upload Insurance Document',
        iremboHint: 'Apply at irembo.gov.rw',
      },
      legal: {
        driverTermsText: 'Driver terms text',
        driverTermsAgree: 'I agree to the driver terms',
      },
      common: { back: 'Back', save: 'Save' },
    },
    true,
    true,
  );
  await i18n.changeLanguage('en');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function driverProfilePosts(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls
    .filter(
      (c: any[]) =>
        String(c[0]).includes('/api/users/me/driver-profile') &&
        (c[1] as RequestInit | undefined)?.method === 'POST',
    )
    .map((c: any[]) => JSON.parse(String((c[1] as RequestInit).body)));
}

describe('RegisterPage — plate is compliance-conditional', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let showToast: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async (url: string) => {
      if (String(url).endsWith('/api/users/me')) {
        return { ok: true, status: 200, json: async () => ({ id: 'u1' }) } as any;
      }
      if (String(url).endsWith('/api/users/me/driver-profile')) {
        return { ok: true, status: 201, json: async () => ({ vehicleType: 'BIKE' }) } as any;
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    showToast = vi.fn();
    useUIStore.setState({ showToast } as any);
    useAuthStore.setState({ token: 'tok', user: null } as any);
  });

  function fillCommonFields() {
    fireEvent.change(screen.getByLabelText('Nickname'), {
      target: { value: 'Claudine' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Driver/ }));
  }

  test('a BIKE driver registers without a plate — no plate field, no plate error', async () => {
    render(
      <MemoryRouter>
        <RegisterPage />
      </MemoryRouter>,
    );
    fillCommonFields();
    fireEvent.click(screen.getByRole('button', { name: 'Bicycle Taxi' }));

    // The plate input disappears for plate-free vehicle types.
    expect(screen.queryByLabelText('Registration plate')).not.toBeInTheDocument();
    expect(screen.getByText('No documents required for bicycle taxis.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(driverProfilePosts(fetchMock)).toHaveLength(1));

    const body = driverProfilePosts(fetchMock)[0];
    expect(body.vehicleType).toBe('BIKE');
    expect(body.registrationPlate).toBeUndefined();
    expect(showToast).not.toHaveBeenCalledWith('Plate is required', 'error');
  });

  test('a MOTO driver without a plate is still refused client-side', async () => {
    render(
      <MemoryRouter>
        <RegisterPage />
      </MemoryRouter>,
    );
    fillCommonFields();
    // MOTO is the default selection; the plate field is present.
    expect(screen.getByLabelText('Registration plate')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('Plate is required', 'error'),
    );
    expect(driverProfilePosts(fetchMock)).toHaveLength(0);
  });

  test('the vehicle options are the real VehicleType enum', () => {
    render(
      <MemoryRouter>
        <RegisterPage />
      </MemoryRouter>,
    );
    fillCommonFields();
    for (const label of ['Bicycle Taxi', 'Moto Taxi', 'E-Moto Taxi', 'E-Bike Taxi']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });
});

describe('DriverVerificationPage — inputs follow the compliance matrix', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })) as any,
    );
  });

  function setDriver(vehicleType: string) {
    useAuthStore.setState({
      token: 'tok',
      user: {
        id: 'driver-1',
        role: 'DRIVER',
        driverProfile: { vehicleType, verificationStatus: 'PENDING' },
      } as any,
      isAuthenticated: true,
      isLoading: false,
    });
  }

  test('BIKE: identifier input shows the jacket-number label; licence/coop/insurance absent', () => {
    setDriver('BIKE');
    render(
      <MemoryRouter>
        <DriverVerificationPage />
      </MemoryRouter>,
    );
    expect(
      screen.getByLabelText('Bimoto driver number (jacket number)'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Driving License Number/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Cooperative Name')).not.toBeInTheDocument();
    expect(
      screen.queryByText('I confirm my vehicle has valid third-party insurance'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Upload RURA Authorization')).not.toBeInTheDocument();
  });

  test('MOTO: identifier input keeps the RURA label; full document set required', () => {
    setDriver('MOTO');
    render(
      <MemoryRouter>
        <DriverVerificationPage />
      </MemoryRouter>,
    );
    expect(
      screen.getByLabelText('RURA Transport Authorization Number'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Driving License Number/)).toBeInTheDocument();
    expect(screen.getByLabelText('Cooperative Name')).toBeInTheDocument();
    expect(
      screen.getByText('I confirm my vehicle has valid third-party insurance'),
    ).toBeInTheDocument();
    expect(screen.getByText('Upload RURA Authorization')).toBeInTheDocument();
  });
});

describe('AdminVerifications — vehicle-derived requirement copy', () => {
  const BIKE_ROW = {
    id: 'dp-2',
    userId: 'driver-2',
    vehicleType: 'BIKE',
    drivingLicenseNumber: null,
    ruraAuthorizationNumber: 'BM-SIM-002',
    registrationPlate: null,
    drivingLicensePhotoUrl: null,
    ruraAuthorizationPhotoUrl: null,
    insurancePhotoUrl: null,
    verificationStatus: 'UNDER_REVIEW',
    user: { id: 'driver-2', nickname: 'Claudine' },
  };
  const MOTO_ROW = {
    ...BIKE_ROW,
    id: 'dp-3',
    userId: 'driver-3',
    vehicleType: 'MOTO',
    ruraAuthorizationNumber: null,
    verificationStatus: 'UNDER_REVIEW',
    user: { id: 'driver-3', nickname: 'Jean' },
  };

  function mockFetch(approveResponse?: { status: number; body: unknown }) {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/approve')) {
        const r = approveResponse ?? { status: 200, body: { profile: {} } };
        return {
          ok: r.status < 400,
          status: r.status,
          json: async () => r.body,
        } as any;
      }
      if (String(url).includes('/api/admin/verifications')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ verifications: [BIKE_ROW, MOTO_ROW] }),
        } as any;
      }
      throw new Error(`unexpected fetch: ${url} ${init?.method ?? 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  test('requirement text derives from the vehicle type; identifier label follows RURA applicability', async () => {
    mockFetch();
    render(<AdminVerifications />);
    await waitFor(() => expect(screen.getByText('Claudine')).toBeInTheDocument());

    expect(
      screen.getByText('Required for approval: driver number (jacket)'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Required for approval: RURA number + registration plate'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Driver Nº: BM-SIM-002/)).toBeInTheDocument();
  });

  test('a failed approve surfaces the actual missing list from the gate', async () => {
    mockFetch({
      status: 422,
      body: {
        error: {
          code: 'DRIVER_MISSING_IDENTIFIERS',
          message: 'errors.driverMissingIdentifiers',
          details: { missing: ['ruraAuthorizationNumber', 'registrationPlate'] },
        },
      },
    });
    render(<AdminVerifications />);
    await waitFor(() => expect(screen.getByText('Jean')).toBeInTheDocument());

    const approveButtons = screen.getAllByRole('button', { name: 'Approve' });
    fireEvent.click(approveButtons[1]);
    await waitFor(() =>
      expect(
        screen.getByText(
          'Cannot approve: still missing driver number (jacket), registration plate.',
        ),
      ).toBeInTheDocument(),
    );
  });
});
