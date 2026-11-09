// PREPROTO-SIM G4 — the "SIMULATION — no real money" banner: shown only
// when authenticated AND the server has positively reported a simulated
// mode; dismissible per session; carries the inbox link only when SMS
// is the simulated channel.
import { describe, test, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import '../__tests__/setup';

import { SimulationBanner } from '../components/ui/SimulationBanner';
import { useAuthStore } from '../stores/auth.store';
import { useSimulationStore } from '../stores/simulation.store';

beforeEach(() => {
  useAuthStore.setState({ isAuthenticated: true, user: { id: 'u1' } as any });
  useSimulationStore.setState({
    paymentsMode: 'live',
    smsMode: 'live',
    bannerDismissed: false,
  });
});

describe('SimulationBanner', () => {
  test('renders nothing in fully live mode', () => {
    render(<SimulationBanner />);
    expect(screen.queryByTestId('simulation-banner')).toBeNull();
  });

  test('renders nothing when unauthenticated, even in simulated mode', () => {
    useAuthStore.setState({ isAuthenticated: false, user: null });
    useSimulationStore.setState({ paymentsMode: 'simulated', smsMode: 'simulated' });
    render(<SimulationBanner />);
    expect(screen.queryByTestId('simulation-banner')).toBeNull();
  });

  test('shows when payments are simulated (no inbox link without simulated SMS)', () => {
    useSimulationStore.setState({ paymentsMode: 'simulated', smsMode: 'live' });
    render(<SimulationBanner />);
    expect(screen.getByTestId('simulation-banner')).toBeInTheDocument();
    expect(screen.getByText('simulation.banner')).toBeInTheDocument();
    expect(screen.queryByText('simulation.inboxLink')).toBeNull();
  });

  test('shows the guarded inbox link when SMS is simulated', () => {
    useSimulationStore.setState({ paymentsMode: 'simulated', smsMode: 'simulated' });
    render(<SimulationBanner />);
    const link = screen.getByText('simulation.inboxLink') as HTMLAnchorElement;
    expect(link.href).toContain('/api/sim/inbox');
  });

  test('dismiss hides it for the session (store flag, not persistence)', () => {
    useSimulationStore.setState({ paymentsMode: 'simulated', smsMode: 'simulated' });
    render(<SimulationBanner />);
    fireEvent.click(screen.getByLabelText('simulation.dismiss'));
    expect(screen.queryByTestId('simulation-banner')).toBeNull();
    expect(useSimulationStore.getState().bannerDismissed).toBe(true);
  });
});
