import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AdminConflictAudit from '../AdminConflictAudit';

function makeOk(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as any;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const renderPage = () =>
  render(
    <MemoryRouter>
      <AdminConflictAudit />
    </MemoryRouter>,
  );

describe('AdminConflictAudit', () => {
  test('verify button triggers a fetch to /audit/verify', async () => {
    const fetchMock = vi.fn(async (url: any) => {
      if (typeof url === 'string' && url.includes('/audit/verify')) {
        return makeOk({ valid: true, brokenAt: null, entries: 5 });
      }
      return makeOk({ actions: [] });
    });
    (globalThis as any).fetch = fetchMock;

    renderPage();

    // Wait for initial load.
    await waitFor(() =>
      expect(screen.getByText('Audit Log')).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: /Verify chain integrity/i }));

    await waitFor(() => {
      const calls = fetchMock.mock.calls.map((c: any[]) => String(c[0]));
      expect(calls.some((u) => u.includes('/audit/verify'))).toBe(true);
    });
  });

  test('valid=true renders the green check', async () => {
    const fetchMock = vi.fn(async (url: any) => {
      if (typeof url === 'string' && url.includes('/audit/verify')) {
        return makeOk({ valid: true, brokenAt: null, entries: 7 });
      }
      return makeOk({ actions: [] });
    });
    (globalThis as any).fetch = fetchMock;

    renderPage();
    await waitFor(() =>
      expect(screen.getByText('Audit Log')).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: /Verify chain integrity/i }));

    await waitFor(() =>
      expect(screen.getByText(/Chain intact \(7 entries\)/)).toBeInTheDocument(),
    );
  });

  test('valid=false renders red broken message', async () => {
    const fetchMock = vi.fn(async (url: any) => {
      if (typeof url === 'string' && url.includes('/audit/verify')) {
        return makeOk({ valid: false, brokenAt: 'entry-3', entries: 4 });
      }
      return makeOk({ actions: [] });
    });
    (globalThis as any).fetch = fetchMock;

    renderPage();
    await waitFor(() =>
      expect(screen.getByText('Audit Log')).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: /Verify chain integrity/i }));

    await waitFor(() =>
      expect(
        screen.getByText(/Chain broken at entry-3 \(4 entries scanned\)/),
      ).toBeInTheDocument(),
    );
  });

  test('type filter triggers a re-fetch with the filter parameter', async () => {
    const fetchMock = vi.fn(async () => makeOk({ actions: [] }));
    (globalThis as any).fetch = fetchMock;

    renderPage();
    await waitFor(() =>
      expect(screen.getByText('Audit Log')).toBeInTheDocument(),
    );

    const initialCallCount = fetchMock.mock.calls.length;

    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'AML_APPEAL' },
    });

    await waitFor(() => {
      const calls = fetchMock.mock.calls.map((c: any[]) => String(c[0]));
      expect(calls.length).toBeGreaterThan(initialCallCount);
      expect(calls.some((u) => u.includes('type=AML_APPEAL'))).toBe(true);
    });
  });
});
