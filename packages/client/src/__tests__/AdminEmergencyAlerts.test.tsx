// SOS-WIRE G4 — admin emergency banner tests. An emergency-alert socket
// event renders a persistent red banner (rider phone + journey id) that
// never auto-dismisses; concurrent alerts for different journeys stack;
// repeated alerts for the same journey bump a counter instead of
// duplicating; only the explicit "Acknowledged" click clears one.

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SOCKET_EVENTS } from '@bimoto/shared';
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
import { useAuthStore } from '../stores/auth.store';
import { useEmergencyAlertStore } from '../stores/emergency-alert.store';

const STRINGS = {
  emergency: {
    adminBannerTitle: 'Emergency — rider needs help',
    adminBannerTitleDriver: 'Emergency — driver needs help',
    adminRiderPhone: 'Rider phone',
    adminDriverPhone: 'Driver phone',
    adminPlate: 'plate',
    adminJourney: 'Journey',
    adminAcknowledge: 'Acknowledged',
    alertReceived: 'Emergency alert on this ride',
  },
};

function fire(evt: string, payload: unknown) {
  act(() => {
    for (const h of handlers.get(evt) ?? []) h(payload);
  });
}

function connect() {
  // useSocket exposes its socket to consumers only after the 'connect'
  // handler flips isConnected — mirror that handshake.
  fire('connect', undefined);
}

const alertJ1 = {
  journeyId: 'j1',
  userId: 'u1',
  riderPhone: '+250788123456',
  riderNickname: 'TestRider',
  timestamp: '2026-07-24T10:00:00.000Z',
};

beforeEach(async () => {
  handlers.clear();
  i18n.addResourceBundle('en', 'translation', STRINGS, true, true);
  await i18n.changeLanguage('en');
  useAuthStore.setState({ token: 'tok', isAuthenticated: true, isLoading: false });
  useEmergencyAlertStore.setState({ alerts: [] });
});

// OUTBOX G5 — the two payload shapes the SERVER actually emits to the
// admins room (packages/server/src/routes/journey.routes.ts, channel 2).
// rider* always means the PASSENGER and driver* always means the MOTARI,
// in BOTH directions; raisedBy is the only field that says whose
// emergency it is. Both fixtures below are the full admin-room shape.
const passengerRaised = {
  journeyId: 'j-pax',
  userId: 'u-pax',
  raisedBy: 'CUSTOMER' as const,
  riderNickname: 'TestRider',
  riderPhone: '+250788123456',
  driverNickname: 'Jean',
  driverPhone: '+250788654321',
  driverPlate: 'RAB 123 X',
  timestamp: '2026-08-15T10:00:00.000Z',
};

const driverRaised = {
  ...passengerRaised,
  journeyId: 'j-drv',
  userId: 'u-drv',
  raisedBy: 'DRIVER' as const,
};

describe('AdminEmergencyAlerts — who pressed the button', () => {
  test('a driver-raised alert says DRIVER and leads with his number', () => {
    render(<AdminEmergencyAlerts />);
    connect();
    fire(SOCKET_EVENTS.EMERGENCY_ALERT, driverRaised);

    const banner = screen.getByTestId('emergency-alert-banner');
    expect(screen.getByTestId('emergency-alert-title')).toHaveTextContent(
      'Emergency — driver needs help',
    );
    // The person in trouble is the one ops is told to call first.
    const primary = screen.getByTestId('emergency-alert-primary-contact');
    expect(primary).toHaveTextContent('Driver phone');
    expect(primary).toHaveTextContent('+250788654321');
    expect(primary).toHaveTextContent('Jean');
    expect(primary).toHaveTextContent('RAB 123 X');
    // And the passenger is still reachable — ops needs both sides.
    const counterpart = screen.getByTestId('emergency-alert-counterpart');
    expect(counterpart).toHaveTextContent('+250788123456');
    expect(banner).toHaveTextContent('j-drv');
  });

  test('a passenger-raised alert is unchanged: passenger title, passenger number', () => {
    render(<AdminEmergencyAlerts />);
    connect();
    fire(SOCKET_EVENTS.EMERGENCY_ALERT, passengerRaised);

    expect(screen.getByTestId('emergency-alert-title')).toHaveTextContent(
      'Emergency — rider needs help',
    );
    const primary = screen.getByTestId('emergency-alert-primary-contact');
    expect(primary).toHaveTextContent('Rider phone');
    expect(primary).toHaveTextContent('+250788123456');
    expect(screen.queryByTestId('emergency-alert-counterpart')).toBeNull();
  });

  test('the two variants are told apart by raisedBy alone', () => {
    render(<AdminEmergencyAlerts />);
    connect();
    fire(SOCKET_EVENTS.EMERGENCY_ALERT, passengerRaised);
    fire(SOCKET_EVENTS.EMERGENCY_ALERT, driverRaised);

    const titles = screen
      .getAllByTestId('emergency-alert-title')
      .map((n) => n.textContent);
    expect(titles).toEqual([
      'Emergency — rider needs help',
      'Emergency — driver needs help',
    ]);
  });

  test('an alert with no raisedBy keeps the passenger reading it has today', () => {
    render(<AdminEmergencyAlerts />);
    connect();
    const { raisedBy: _dropped, ...preRedButton } = passengerRaised;
    fire(SOCKET_EVENTS.EMERGENCY_ALERT, preRedButton);

    expect(screen.getByTestId('emergency-alert-title')).toHaveTextContent(
      'Emergency — rider needs help',
    );
  });
});

describe('AdminEmergencyAlerts', () => {
  test('renders a banner with rider phone and journey id on the emergency event', () => {
    render(<AdminEmergencyAlerts />);
    connect();
    fire(SOCKET_EVENTS.EMERGENCY_ALERT, alertJ1);

    const banner = screen.getByTestId('emergency-alert-banner');
    expect(banner).toHaveTextContent('Emergency — rider needs help');
    expect(banner).toHaveTextContent('+250788123456');
    expect(banner).toHaveTextContent('j1');
  });

  test('concurrent alerts for different journeys stack', () => {
    render(<AdminEmergencyAlerts />);
    connect();
    fire(SOCKET_EVENTS.EMERGENCY_ALERT, alertJ1);
    fire(SOCKET_EVENTS.EMERGENCY_ALERT, { ...alertJ1, journeyId: 'j2' });

    expect(screen.getAllByTestId('emergency-alert-banner')).toHaveLength(2);
  });

  test('repeat alert for the same journey bumps the counter instead of duplicating', () => {
    render(<AdminEmergencyAlerts />);
    connect();
    fire(SOCKET_EVENTS.EMERGENCY_ALERT, alertJ1);
    fire(SOCKET_EVENTS.EMERGENCY_ALERT, alertJ1);

    const banners = screen.getAllByTestId('emergency-alert-banner');
    expect(banners).toHaveLength(1);
    expect(banners[0]).toHaveTextContent('×2');
  });

  test('banner persists until explicitly acknowledged, then clears', async () => {
    const user = userEvent.setup();
    render(<AdminEmergencyAlerts />);
    connect();
    fire(SOCKET_EVENTS.EMERGENCY_ALERT, alertJ1);
    fire(SOCKET_EVENTS.EMERGENCY_ALERT, { ...alertJ1, journeyId: 'j2' });

    expect(screen.getAllByTestId('emergency-alert-banner')).toHaveLength(2);

    await user.click(screen.getAllByRole('button', { name: 'Acknowledged' })[0]);

    const remaining = screen.getAllByTestId('emergency-alert-banner');
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toHaveTextContent('j2');
  });

  test('alerts survive a remount (route navigation) until acknowledged', () => {
    const { unmount } = render(<AdminEmergencyAlerts />);
    connect();
    fire(SOCKET_EVENTS.EMERGENCY_ALERT, alertJ1);
    unmount();

    render(<AdminEmergencyAlerts />);
    expect(screen.getByTestId('emergency-alert-banner')).toHaveTextContent('j1');
  });
});
