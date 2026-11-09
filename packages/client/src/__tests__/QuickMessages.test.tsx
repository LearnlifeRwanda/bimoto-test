import { describe, test, expect, beforeEach } from 'vitest';
import { render, within, act } from '@testing-library/react';
import { QuickMessages } from '../components/chat/QuickMessages';
import { i18n } from './setup';
import { useAuthStore } from '../stores/auth.store';
import { JourneyStatus, VehicleType } from '@bimoto/shared';

const noop = () => {};

const setRole = (role: 'CUSTOMER' | 'DRIVER' | 'BOTH' | undefined) => {
  useAuthStore.setState({
    token: 'tok',
    isAuthenticated: true,
    isLoading: false,
    user: role
      ? ({
          id: 'u',
          nickname: 'U',
          role,
          language: 'en',
          idVerified: true,
          licenseVerified: true,
          completedRides: 0,
          cancellationCount: 0,
          totalRequests: 0,
        } as any)
      : null,
  });
};

const buttonLabels = (root: HTMLElement) =>
  Array.from(within(root).getAllByRole('button')).map((b) => b.textContent?.trim() ?? '');

describe('QuickMessages context-aware filtering', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  test('role filter still works (CUSTOMER hides driver-only messages)', () => {
    setRole('CUSTOMER');
    const { container } = render(<QuickMessages onSend={noop} />);
    const labels = buttonLabels(container);
    // Driver-only message should be hidden for CUSTOMER role
    expect(labels.some((l) => l.includes('On my way'))).toBe(false);
    // Customer-eligible message should appear
    expect(labels.some((l) => l.includes('Where are you?'))).toBe(true);
  });

  test('journeyStatus filter narrows the visible set', () => {
    setRole('CUSTOMER');
    const { container, rerender } = render(
      <QuickMessages onSend={noop} journeyStatus={JourneyStatus.MATCHED} />,
    );
    // qm_drive_carefully_cust is IN_PROGRESS-only and should not appear for MATCHED
    expect(buttonLabels(container).some((l) => l.includes('drive carefully'))).toBe(false);
    rerender(<QuickMessages onSend={noop} journeyStatus={JourneyStatus.IN_PROGRESS} />);
    expect(buttonLabels(container).some((l) => l.includes('drive carefully'))).toBe(true);
  });

  test('lastReceivedQuickMessageId sorts response candidates first', () => {
    setRole('CUSTOMER');
    const { container } = render(
      <QuickMessages
        onSend={noop}
        journeyStatus={JourneyStatus.MATCHED}
        lastReceivedQuickMessageId="qm_arrived"
      />,
    );
    const labels = buttonLabels(container);
    // qm_arrived's responseSet is ['qm_thank_you', 'qm_5_minutes'].
    // The first non-reply button must come AFTER both reply buttons.
    const idxThankYou = labels.findIndex((l) => l.includes('Thank you'));
    const idx5Min = labels.findIndex((l) => l.includes('5 minutes'));
    expect(idxThankYou).toBeGreaterThanOrEqual(0);
    expect(idx5Min).toBeGreaterThanOrEqual(0);
    // Reply candidates should be among the first two buttons
    expect(idxThankYou).toBeLessThan(2);
    expect(idx5Min).toBeLessThan(2);
  });

  test('messages with empty contexts (universal) survive any journey-status filter', () => {
    setRole('BOTH');
    const { container } = render(
      <QuickMessages onSend={noop} journeyStatus={JourneyStatus.EXPIRED} />,
    );
    const labels = buttonLabels(container);
    // qm_help_needed has contexts: [] (universal), should always render
    expect(labels.some((l) => l.includes('Help needed'))).toBe(true);
  });

  test('locale switch re-renders all buttons in the new locale', async () => {
    setRole('CUSTOMER');
    const { container } = render(
      <QuickMessages onSend={noop} journeyStatus={JourneyStatus.MATCHED} />,
    );
    expect(buttonLabels(container).some((l) => l.includes('Where are you?'))).toBe(true);

    await act(async () => {
      await i18n.changeLanguage('fr');
    });
    const { container: frContainer } = render(
      <QuickMessages onSend={noop} journeyStatus={JourneyStatus.MATCHED} />,
    );
    expect(buttonLabels(frContainer).some((l) => l.includes('Où êtes-vous'))).toBe(true);
  });

  // R3-V — vehicleType prop filters out messages whose vehicleTypes list
  // doesn't include the journey's vehicle.
  test('BIKE journey hides MOTO-only "Helmet ready" message', () => {
    setRole('CUSTOMER');
    const { container } = render(
      <QuickMessages
        onSend={noop}
        journeyStatus={JourneyStatus.MATCHED}
        vehicleType={VehicleType.BIKE}
      />,
    );
    expect(buttonLabels(container).some((l) => l.includes('Please wear a helmet'))).toBe(false);
  });

  test('MOTO journey shows MOTO-tagged "Please wear a helmet" message', () => {
    setRole('CUSTOMER');
    const { container } = render(
      <QuickMessages
        onSend={noop}
        journeyStatus={JourneyStatus.MATCHED}
        vehicleType={VehicleType.MOTO}
      />,
    );
    expect(buttonLabels(container).some((l) => l.includes('Please wear a helmet'))).toBe(true);
  });

  test('omitting vehicleType prop bypasses the filter (every vehicle-tagged message survives)', () => {
    setRole('CUSTOMER');
    const { container } = render(
      <QuickMessages onSend={noop} journeyStatus={JourneyStatus.MATCHED} />,
    );
    // With no vehicleType prop, the helmet message (MOTO/E_MOTO-tagged) is still shown.
    expect(buttonLabels(container).some((l) => l.includes('Please wear a helmet'))).toBe(true);
  });
});
