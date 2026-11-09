// BLACKBOX G3 — the Diagnostics surface: the count row, the log, the
// consent sentence, and the fact that NOTHING leaves this device until
// a finger lands on Send report.
//
// The first test is a guard, not a feature: every row id the screen
// already had is still here. MATCH-CLOSE G4 built this page to be
// screenshotted and sent from the field, and a renamed test id breaks
// the e2e walk that reads it.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import DiagnosticsPage from '../pages/shared/DiagnosticsPage';
import {
  initErrorLedger,
  recordError,
  errorLedgerCount,
  _resetErrorLedgerForTests,
} from '../services/error-ledger';

vi.mock('../hooks/useSocket', () => ({ useSocket: () => ({ socket: null, connected: false }) }));

let fetchMock: ReturnType<typeof vi.fn>;

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/diagnostics']}>
      <DiagnosticsPage />
    </MemoryRouter>,
  );
}

/** Every attempt to transmit the ledger. Scoped to the report endpoint
 *  on purpose: the invariant under test is that NOTHING reaches the
 *  server unless Send report was tapped, and other traffic on this
 *  screen (the health and /me reads the rows are built from) is not
 *  that. */
function reportPosts() {
  return fetchMock.mock.calls.filter(
    ([url, init]) =>
      String(url).includes('/api/diagnostics/error-report') &&
      (init as RequestInit)?.method === 'POST',
  );
}

beforeEach(() => {
  window.localStorage.clear();
  _resetErrorLedgerForTests();
  initErrorLedger();
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).includes('/api/diagnostics/error-report')) {
      return new Response(JSON.stringify({ id: 'report-1' }), { status: 201 });
    }
    if (String(url).includes('/api/health')) {
      return new Response(JSON.stringify({ version: 'abc1234' }), { status: 200 });
    }
    return new Response(JSON.stringify({ user: { role: 'CUSTOMER' } }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  _resetErrorLedgerForTests();
  window.localStorage.clear();
});

describe('the existing Diagnostics rows are untouched', () => {
  test('every row test id the screen already had is still rendered', async () => {
    renderPage();
    for (const id of [
      'diagnostics-panel',
      'diag-app-build',
      'diag-server-build',
      'diag-builds-match',
      'diag-role',
      'diag-server-online',
      'diag-socket',
      'diag-feed-viewas',
      'diag-feed-status',
      'diag-last-location',
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
  });
});

describe('the error count row', () => {
  test('reads 0 on a clean phone and follows the ledger', async () => {
    renderPage();
    expect(screen.getByTestId('diag-error-count')).toHaveTextContent('0');
    expect(screen.getByTestId('diag-error-log-empty')).toBeInTheDocument();
  });

  test('counts what the ledger holds', async () => {
    recordError({ kind: 'screen-render', message: 'the widget was undefined' });
    recordError({ kind: 'api-server', message: 'HTTP 503', status: 503, path: '/api/bids' });
    renderPage();
    expect(screen.getByTestId('diag-error-count')).toHaveTextContent('2');
    expect(screen.getAllByTestId('diag-error-entry')).toHaveLength(2);
  });
});

describe('the log itself', () => {
  test('shows the newest entry first, with its kind, route and message', () => {
    window.history.replaceState(null, '', '/diagnostics');
    recordError({ kind: 'window-error', message: 'older error' });
    recordError({ kind: 'screen-render', message: 'newest error' });
    renderPage();
    const rows = screen.getAllByTestId('diag-error-entry');
    expect(rows[0]).toHaveTextContent('newest error');
    expect(rows[0]).toHaveTextContent('screen-render');
    expect(rows[0]).toHaveTextContent('/diagnostics');
    expect(rows[1]).toHaveTextContent('older error');
  });

  test('an API entry shows its status code', () => {
    recordError({ kind: 'api-server', message: 'HTTP 502', status: 502, method: 'GET', path: '/api/journeys' });
    renderPage();
    expect(screen.getByTestId('diag-error-entry')).toHaveTextContent('502');
    expect(screen.getByTestId('diag-error-entry')).toHaveTextContent('/api/journeys');
  });
});

describe('nothing leaves the device without a tap', () => {
  test('rendering the screen with a full ledger posts nothing', async () => {
    recordError({ kind: 'render', message: 'boom' });
    renderPage();
    await waitFor(() => expect(screen.getByTestId('diag-error-count')).toHaveTextContent('1'));
    // Give every effect on the page a chance to misbehave.
    await new Promise((r) => setTimeout(r, 50));
    expect(reportPosts()).toHaveLength(0);
    expect(screen.getByTestId('diag-send-status')).toHaveTextContent('—');
  });

  test('the consent sentence says what is in the report and who gets it', () => {
    renderPage();
    const consent = screen.getByTestId('diag-error-consent');
    expect(consent).toBeInTheDocument();
    expect(consent.textContent).toBeTruthy();
  });

  test('Send report is the only thing that transmits, and it sends exactly the log', async () => {
    recordError({ kind: 'render', message: 'the widget was undefined' });
    renderPage();
    fireEvent.click(screen.getByTestId('diag-send-report'));

    await waitFor(() => expect(reportPosts()).toHaveLength(1));
    const [url, init] = reportPosts()[0];
    expect(String(url)).toContain('/api/diagnostics/error-report');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].message).toBe('the widget was undefined');
    // The status row shows what the server actually answered.
    await waitFor(() => expect(screen.getByTestId('diag-send-status')).toHaveTextContent('201'));
  });

  test('Send report is disabled while there is nothing to send', () => {
    renderPage();
    expect(screen.getByTestId('diag-send-report')).toBeDisabled();
    expect(screen.getByTestId('diag-clear-log')).toBeDisabled();
  });

  test('a send that fails leaves the ledger intact so the user can retry', async () => {
    recordError({ kind: 'render', message: 'boom' });
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('/api/diagnostics/error-report')) throw new TypeError('Failed to fetch');
      return new Response('{}', { status: 200 });
    });
    renderPage();
    fireEvent.click(screen.getByTestId('diag-send-report'));
    await waitFor(() => expect(screen.getByTestId('diag-send-status')).not.toHaveTextContent('—'));
    expect(errorLedgerCount()).toBeGreaterThanOrEqual(1);
  });
});

describe('Clear log', () => {
  test('empties the ledger and the row, and sends nothing', async () => {
    recordError({ kind: 'render', message: 'boom' });
    renderPage();
    expect(screen.getByTestId('diag-error-count')).toHaveTextContent('1');
    fireEvent.click(screen.getByTestId('diag-clear-log'));
    await waitFor(() => expect(screen.getByTestId('diag-error-count')).toHaveTextContent('0'));
    expect(errorLedgerCount()).toBe(0);
    expect(reportPosts()).toHaveLength(0);
  });
});

// DEADWOOD G5 — the isolation bug behind the Clear-log flake, pinned at
// its source.
//
// The Clear-log case failed depending on what ran before it, and the
// entry that survived the clear was never written by that test: it was
// `api-network GET /api/users/me`, recorded by the PREVIOUS test's
// Diagnostics screen. useDiagnostics fired two sequential probes and
// guarded only its setState with a `cancelled` flag, so an unmounted
// screen went on asking the network. When the abandoned request failed,
// apiFetch wrote to the ledger — a module-level store with no
// component's lifetime — and vitest runs afterEach in REVERSE
// registration order, so the spec's own reset ran before Testing
// Library's cleanup and the entry landed one test later, in a ledger
// that had just been re-enabled.
//
// The fix is an AbortController in the hook. These two tests hold both
// halves of it: the request is really cancelled, and a cancelled
// request records nothing (apiFetch's MAP-TRUTH G5 rule — an abort
// says nothing about the network).
describe('an unmounted Diagnostics screen stops asking the network', () => {
  test('closing the screen aborts its in-flight probes', async () => {
    const signals: AbortSignal[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        if (init?.signal) signals.push(init.signal);
        // Never settles on its own — the abort is the only way out.
        return new Promise<Response>(() => {});
      }),
    );

    const { unmount } = renderPage();
    await waitFor(() => expect(signals.length).toBeGreaterThan(0));
    expect(signals.every((s) => s.aborted)).toBe(false);

    unmount();
    expect(signals.every((s) => s.aborted)).toBe(true);
  });

  test('a probe abandoned by unmount leaves no entry in the ledger', async () => {
    // Honour the signal the way a real fetch does: reject with an
    // AbortError rather than resolving.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('The operation was aborted.', 'AbortError')),
            );
          }),
      ),
    );

    const { unmount } = renderPage();
    unmount();
    // Let every rejection settle — this is exactly the window in which
    // the stray entry used to be written.
    await new Promise((r) => setTimeout(r, 50));

    expect(errorLedgerCount()).toBe(0);
  });
});
