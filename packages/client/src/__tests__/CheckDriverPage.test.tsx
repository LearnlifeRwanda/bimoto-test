// DRIVER-ID v3 G3 — public "check a driver" page.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { i18n } from './setup';

import { CheckDriverPage } from '../pages/public/CheckDriverPage';

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      checkDriver: {
        title: 'Check a Bimoto driver',
        subtitle: 'Enter the driver number from a jacket or vest.',
        inputLabel: 'Driver number',
        inputPlaceholder: 'e.g. RURA-12345',
        submit: 'Check',
        active: 'Active Bimoto driver',
        inactive: 'This number is not an active Bimoto driver',
        error: 'Could not check right now. Please try again.',
      },
      vehicle: { moto: 'Moto taxi' },
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

function mockLookup(body: any, ok = true) {
  fetchMock = vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => body }));
  vi.stubGlobal('fetch', fetchMock);
}

const renderPage = () =>
  render(
    <MemoryRouter>
      <CheckDriverPage />
    </MemoryRouter>,
  );

async function submit(number: string) {
  fireEvent.change(screen.getByLabelText('Driver number'), {
    target: { value: number },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Check' }));
}

describe('CheckDriverPage', () => {
  test('active number shows the name and vehicle type', async () => {
    mockLookup({ active: true, firstName: 'Jean', vehicleType: 'MOTO' });
    renderPage();
    await submit('RURA-0001');
    await waitFor(() =>
      expect(screen.getByTestId('check-driver-active')).toBeInTheDocument(),
    );
    expect(screen.getByText('Jean')).toBeInTheDocument();
    expect(screen.getByText('Moto taxi')).toBeInTheDocument();
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/driver-id/RURA-0001');
  });

  test('non-active number shows the uniform negative', async () => {
    mockLookup({ active: false });
    renderPage();
    await submit('RURA-DEAD');
    await waitFor(() =>
      expect(screen.getByTestId('check-driver-inactive')).toHaveTextContent(
        'This number is not an active Bimoto driver',
      ),
    );
    expect(screen.queryByTestId('check-driver-active')).not.toBeInTheDocument();
  });

  test('server failure shows the retry message, not a false negative', async () => {
    mockLookup({}, false);
    renderPage();
    await submit('RURA-0001');
    await waitFor(() =>
      expect(screen.getByTestId('check-driver-error')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('check-driver-inactive')).not.toBeInTheDocument();
  });

  test('submit is disabled while the input is empty', () => {
    mockLookup({ active: false });
    renderPage();
    expect(screen.getByRole('button', { name: 'Check' })).toBeDisabled();
  });
});
