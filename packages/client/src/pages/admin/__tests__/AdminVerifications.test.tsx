// DRIVER-ID v3 G2 — admin revocation surface on the verification queue.
//
// The revoke action follows the destructive-confirm convention: reason
// first (min 10 chars), then an explicit confirm box; no POST fires
// until Confirm.

import { describe, test, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import AdminVerifications from '../AdminVerifications';

const VERIFIED_ROW = {
  id: 'dp-1',
  userId: 'driver-1',
  vehicleType: 'MOTO',
  drivingLicenseNumber: 'LIC-1',
  ruraAuthorizationNumber: 'RURA-0001',
  registrationPlate: 'RAC 123A',
  drivingLicensePhotoUrl: null,
  ruraAuthorizationPhotoUrl: null,
  insurancePhotoUrl: null,
  verificationStatus: 'VERIFIED',
  user: { id: 'driver-1', nickname: 'Jean' },
};

let fetchMock: ReturnType<typeof vi.fn>;

function mockFetch() {
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).includes('/revoke')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          profile: { verificationStatus: 'REVOKED' },
          adminAction: { id: 'aa-1', action: 'REVOKE_DRIVER' },
          withdrawnBidCount: 2,
          settlement: { batchId: 'batch-1', amount: 4200, deferredForFreeze: false },
        }),
      } as any;
    }
    if (String(url).includes('/api/admin/verifications')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ verifications: [VERIFIED_ROW] }),
      } as any;
    }
    throw new Error(`unexpected fetch: ${url} ${init?.method ?? 'GET'}`);
  });
  vi.stubGlobal('fetch', fetchMock);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function revokePosts(): [string, RequestInit][] {
  return fetchMock.mock.calls
    .filter(
      (c: any[]) =>
        (c[1] as RequestInit | undefined)?.method === 'POST' &&
        String(c[0]).includes('/revoke'),
    )
    .map((c: any[]) => [String(c[0]), c[1] as RequestInit]);
}

describe('AdminVerifications — revoke flow', () => {
  test('revoke button is disabled until a 10-char reason is entered', async () => {
    mockFetch();
    render(<AdminVerifications />);
    await waitFor(() => expect(screen.getByText('Jean')).toBeInTheDocument());

    const btn = screen.getByRole('button', { name: 'Revoke…' });
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Revocation reason'), {
      target: { value: 'short' },
    });
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Revocation reason'), {
      target: { value: 'RURA authorization withdrawn' },
    });
    expect(btn).not.toBeDisabled();
  });

  test('no POST until Confirm; the dialog states settlement and re-application', async () => {
    mockFetch();
    render(<AdminVerifications />);
    await waitFor(() => expect(screen.getByText('Jean')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Revocation reason'), {
      target: { value: 'RURA authorization withdrawn' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Revoke…' }));

    const box = screen.getByTestId('revoke-confirm-box');
    expect(box).toHaveTextContent(/remaining earnings are paid out/i);
    expect(box).toHaveTextContent(/re-applies through verification/i);
    expect(box).toHaveTextContent(/nothing is deleted/i);
    expect(revokePosts()).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Confirm revoke' }));
    await waitFor(() => expect(revokePosts()).toHaveLength(1));
    const [url, init] = revokePosts()[0];
    expect(url).toContain('/api/admin/verifications/driver-1/revoke');
    expect(JSON.parse(String(init.body))).toEqual({
      reason: 'RURA authorization withdrawn',
    });
    await waitFor(() =>
      expect(screen.getByText(/Driver revoked — 2 open bid\(s\) withdrawn/)).toBeInTheDocument(),
    );
  });

  test('Cancel aborts without firing the POST', async () => {
    mockFetch();
    render(<AdminVerifications />);
    await waitFor(() => expect(screen.getByText('Jean')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Revocation reason'), {
      target: { value: 'RURA authorization withdrawn' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Revoke…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByTestId('revoke-confirm-box')).not.toBeInTheDocument();
    expect(revokePosts()).toHaveLength(0);
  });

  test('status filter re-fetches with ?status=', async () => {
    mockFetch();
    render(<AdminVerifications />);
    await waitFor(() => expect(screen.getByText('Jean')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Status filter'), {
      target: { value: 'REVOKED' },
    });
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some((c: any[]) =>
          String(c[0]).includes('/api/admin/verifications?status=REVOKED'),
        ),
      ).toBe(true),
    );
  });
});
