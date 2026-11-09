// LOOSE-ENDS G3 — the emergency surfaces say "parcel" when it is a
// parcel, and keep saying "ride" when it is a ride.
//
// #167's `raisedBy` fixed WHO pressed the button. Nothing said WHAT KIND
// of journey it was, so a motari carrying somebody's parcel raised an
// alert and the admin panel announced a ride with a passenger, while the
// sender watching the parcel move got a toast about "this ride".
//
// Two consumers branch, and both are covered here:
//   * the admin banner (title + the customer's phone label);
//   * the in-journey toast in useSocket.
//
// The branch under test is `journeyType !== 'PASSENGER'`, never
// `=== 'GOODS'` — JourneyType has four members and three of them are
// parcels. And the fallback is pinned: a #166-era payload with no
// journeyType keeps exactly the ride-shaped wording it renders today,
// because deployed APKs emit no such field.

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { renderHook, waitFor } from '@testing-library/react';
import { SOCKET_EVENTS, JourneyType } from '@bimoto/shared';
import { i18n } from './setup';

const { handlers, mockSocket, ioMock } = vi.hoisted(() => {
  const handlers = new Map<string, Array<(...args: any[]) => void>>();
  const mockSocket = {
    on: (evt: string, cb: (...args: any[]) => void) => {
      handlers.set(evt, [...(handlers.get(evt) ?? []), cb]);
      return mockSocket;
    },
    off: (evt: string, cb: (...args: any[]) => void) => {
      handlers.set(
        evt,
        (handlers.get(evt) ?? []).filter((h) => h !== cb),
      );
      return mockSocket;
    },
    emit: () => mockSocket,
    disconnect: () => {},
    connected: true,
  };
  return { handlers, mockSocket, ioMock: { io: () => mockSocket } };
});

vi.mock('socket.io-client', () => ioMock);

import { AdminEmergencyAlerts } from '../components/admin/AdminEmergencyAlerts';
import { useSocket } from '../hooks/useSocket';
import { useAuthStore } from '../stores/auth.store';
import { useUIStore } from '../stores/ui.store';
import { useEmergencyAlertStore } from '../stores/emergency-alert.store';

// The real shipped English, so a copy change that breaks the meaning
// breaks this test rather than passing under a stub.
const STRINGS = {
  emergency: {
    adminBannerTitle: 'Emergency — passenger needs help',
    adminBannerTitleDriver: 'Emergency — driver needs help',
    adminBannerTitleDriverParcel: 'Emergency — driver carrying a parcel needs help',
    adminBannerTitleSender: 'Emergency — parcel sender needs help',
    adminRiderPhone: 'Passenger phone',
    adminSenderPhone: 'Sender phone',
    adminDriverPhone: 'Driver phone',
    adminPlate: 'plate',
    adminJourney: 'Journey',
    adminAcknowledge: 'Acknowledged',
    alertReceived: 'Emergency alert on this ride',
    alertReceivedParcel: 'Emergency alert on this parcel delivery',
  },
};

/** The full admins-room payload the server emits (channel 2). */
const baseAlert = {
  journeyId: 'j-1',
  userId: 'u-1',
  raisedBy: 'CUSTOMER' as const,
  riderNickname: 'TestSender',
  riderPhone: '+250788123456',
  driverNickname: 'Jean',
  driverPhone: '+250788654321',
  driverPlate: 'RAB 123 X',
  timestamp: '2026-08-16T10:00:00.000Z',
};

const PARCEL_TYPES = [
  JourneyType.GOODS,
  JourneyType.PRIORITY_MESSENGER,
  JourneyType.URGENT_MESSENGER,
] as const;

function fire(evt: string, payload: unknown) {
  act(() => {
    for (const h of handlers.get(evt) ?? []) h(payload);
  });
}

function connect() {
  fire('connect', undefined);
}

beforeEach(async () => {
  handlers.clear();
  i18n.addResourceBundle('en', 'translation', STRINGS, true, true);
  await i18n.changeLanguage('en');
  useAuthStore.setState({ token: 'tok', isAuthenticated: true, isLoading: false });
  useUIStore.setState({ toasts: [], toastMessage: null, toastType: null });
  useEmergencyAlertStore.setState({ alerts: [] });
});

describe('admin banner — the journey kind', () => {
  test.each(PARCEL_TYPES)('%s raised by the sender: sender title, sender label', (journeyType) => {
    render(<AdminEmergencyAlerts />);
    connect();
    fire(SOCKET_EVENTS.EMERGENCY_ALERT, { ...baseAlert, journeyType });

    expect(screen.getByTestId('emergency-alert-title')).toHaveTextContent(
      'Emergency — parcel sender needs help',
    );
    const primary = screen.getByTestId('emergency-alert-primary-contact');
    expect(primary).toHaveTextContent('Sender phone');
    expect(primary).toHaveTextContent('+250788123456');
    expect(primary).not.toHaveTextContent('Passenger phone');
  });

  test.each(PARCEL_TYPES)('%s raised by the motari: parcel title, sender counterpart', (journeyType) => {
    render(<AdminEmergencyAlerts />);
    connect();
    fire(SOCKET_EVENTS.EMERGENCY_ALERT, {
      ...baseAlert,
      raisedBy: 'DRIVER' as const,
      journeyType,
    });

    expect(screen.getByTestId('emergency-alert-title')).toHaveTextContent(
      'Emergency — driver carrying a parcel needs help',
    );
    // He is still the one ops calls first, with his plate.
    const primary = screen.getByTestId('emergency-alert-primary-contact');
    expect(primary).toHaveTextContent('Driver phone');
    expect(primary).toHaveTextContent('RAB 123 X');
    // The other party is the SENDER, and ops can still reach him.
    const counterpart = screen.getByTestId('emergency-alert-counterpart');
    expect(counterpart).toHaveTextContent('Sender phone');
    expect(counterpart).toHaveTextContent('+250788123456');
  });

  test('an explicit PASSENGER journey renders exactly the ride wording', () => {
    render(<AdminEmergencyAlerts />);
    connect();
    fire(SOCKET_EVENTS.EMERGENCY_ALERT, {
      ...baseAlert,
      journeyType: JourneyType.PASSENGER,
    });

    expect(screen.getByTestId('emergency-alert-title')).toHaveTextContent(
      'Emergency — passenger needs help',
    );
    expect(screen.getByTestId('emergency-alert-primary-contact')).toHaveTextContent(
      'Passenger phone',
    );
  });

  test('a #166-era payload with no journeyType keeps the ride wording', () => {
    render(<AdminEmergencyAlerts />);
    connect();
    // Exactly what a deployed APK's server emitted before this change.
    fire(SOCKET_EVENTS.EMERGENCY_ALERT, baseAlert);

    expect(screen.getByTestId('emergency-alert-title')).toHaveTextContent(
      'Emergency — passenger needs help',
    );
    expect(screen.getByTestId('emergency-alert-primary-contact')).toHaveTextContent(
      'Passenger phone',
    );
  });

  test('journey kind and raisedBy are independent dimensions', () => {
    render(<AdminEmergencyAlerts />);
    connect();
    fire(SOCKET_EVENTS.EMERGENCY_ALERT, { ...baseAlert, journeyId: 'a' });
    fire(SOCKET_EVENTS.EMERGENCY_ALERT, {
      ...baseAlert,
      journeyId: 'b',
      raisedBy: 'DRIVER' as const,
    });
    fire(SOCKET_EVENTS.EMERGENCY_ALERT, {
      ...baseAlert,
      journeyId: 'c',
      journeyType: JourneyType.GOODS,
    });
    fire(SOCKET_EVENTS.EMERGENCY_ALERT, {
      ...baseAlert,
      journeyId: 'd',
      raisedBy: 'DRIVER' as const,
      journeyType: JourneyType.URGENT_MESSENGER,
    });

    expect(screen.getAllByTestId('emergency-alert-title').map((n) => n.textContent)).toEqual([
      'Emergency — passenger needs help',
      'Emergency — driver needs help',
      'Emergency — parcel sender needs help',
      'Emergency — driver carrying a parcel needs help',
    ]);
  });
});

describe('in-journey toast — the journey kind', () => {
  test.each(PARCEL_TYPES)('%s raises the parcel toast', async (journeyType) => {
    renderHook(() => useSocket());
    fire(SOCKET_EVENTS.EMERGENCY_ALERT, { ...baseAlert, journeyType });

    await waitFor(() =>
      expect(useUIStore.getState().toastMessage).toBe('Emergency alert on this parcel delivery'),
    );
    expect(useUIStore.getState().toastType).toBe('error');
  });

  test('a passenger journey raises the ride toast', async () => {
    renderHook(() => useSocket());
    fire(SOCKET_EVENTS.EMERGENCY_ALERT, { ...baseAlert, journeyType: JourneyType.PASSENGER });

    await waitFor(() =>
      expect(useUIStore.getState().toastMessage).toBe('Emergency alert on this ride'),
    );
  });

  test('a payload with no journeyType raises the ride toast it raises today', async () => {
    renderHook(() => useSocket());
    fire(SOCKET_EVENTS.EMERGENCY_ALERT, baseAlert);

    await waitFor(() =>
      expect(useUIStore.getState().toastMessage).toBe('Emergency alert on this ride'),
    );
  });

  test('an empty payload does not throw — the toast still fires', async () => {
    renderHook(() => useSocket());
    fire(SOCKET_EVENTS.EMERGENCY_ALERT, undefined);

    await waitFor(() =>
      expect(useUIStore.getState().toastMessage).toBe('Emergency alert on this ride'),
    );
  });
});
