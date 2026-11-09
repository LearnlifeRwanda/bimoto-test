// BLACKBOX G2/G5 — the wiring, at the level that matters to the field:
// each of the five error classes measured in docs/error-ledger.md §1
// now produces EXACTLY ONE ledger entry, and the recovery behaviour the
// two boundaries already shipped is untouched.
//
// The boundary-behaviour assertions here deliberately duplicate what
// ErrorBoundary.test.tsx and ScreenErrorBoundary.test.tsx already prove.
// That is the point: "the recorder observes, it does not alter recovery"
// is a claim about these two components, and it is worth asserting in
// the same file that proves recording happens.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { ScreenErrorBoundary } from '../components/ScreenErrorBoundary';
import { apiFetch } from '../lib/api';
import {
  errorLedgerCount,
  initErrorLedger,
  readErrorLedger,
  _resetErrorLedgerForTests,
} from '../services/error-ledger';

function Bomb(): React.ReactElement {
  throw new Error('the widget was undefined');
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  window.localStorage.clear();
  _resetErrorLedgerForTests();
  initErrorLedger();
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
  _resetErrorLedgerForTests();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe('A. render error inside a screen (ScreenErrorBoundary)', () => {
  test('records exactly one entry AND still shows the recovery UI', () => {
    render(
      <MemoryRouter initialEntries={['/diagnostics']}>
        <ScreenErrorBoundary>
          <Bomb />
        </ScreenErrorBoundary>
      </MemoryRouter>,
    );

    // Recovery, unchanged: the in-place fallback with both buttons.
    expect(screen.getByTestId('screen-error-fallback')).toBeInTheDocument();
    expect(screen.getByTestId('screen-error-retry')).toBeInTheDocument();
    expect(screen.getByTestId('screen-error-home')).toBeInTheDocument();

    expect(errorLedgerCount()).toBe(1);
    const [entry] = readErrorLedger();
    expect(entry.kind).toBe('screen-render');
    expect(entry.message).toBe('the widget was undefined');
    expect(entry.stack).toBeTruthy();
  });

  test('Retry still clears the fallback, and does not record again', () => {
    let shouldThrow = true;
    const Flaky = () => {
      if (shouldThrow) throw new Error('the widget was undefined');
      return <p>recovered screen</p>;
    };
    render(
      <MemoryRouter initialEntries={['/diagnostics']}>
        <ScreenErrorBoundary>
          <Flaky />
        </ScreenErrorBoundary>
      </MemoryRouter>,
    );
    expect(errorLedgerCount()).toBe(1);
    shouldThrow = false;
    fireEvent.click(screen.getByTestId('screen-error-retry'));
    expect(screen.getByText('recovered screen')).toBeInTheDocument();
    expect(errorLedgerCount()).toBe(1);
  });
});

describe('B. render error outside a screen (top-level ErrorBoundary)', () => {
  test('records exactly one entry AND still shows the retry screen', () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );

    // Recovery, unchanged.
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    // The clear-caches rung is still hidden on a first crash.
    expect(screen.queryByTestId('boundary-clear-caches')).not.toBeInTheDocument();

    expect(errorLedgerCount()).toBe(1);
    const [entry] = readErrorLedger();
    expect(entry.kind).toBe('render');
    expect(entry.message).toBe('the widget was undefined');
  });

  test('the crash-loop ladder still escalates after a retry', () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    // Same crash straight after a recovery = crash loop → rung 2 appears.
    expect(screen.getByTestId('boundary-clear-caches')).toBeInTheDocument();
    // Two crashes, two entries — one per crash, no more.
    expect(errorLedgerCount()).toBe(2);
  });

  test('a ledger that is off changes nothing about recovery', () => {
    _resetErrorLedgerForTests(); // leaves the ledger disabled
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(errorLedgerCount()).toBe(0);
  });
});

describe('C. unhandled promise rejection', () => {
  test('records exactly one entry', () => {
    window.dispatchEvent(
      Object.assign(new Event('unhandledrejection'), { reason: new Error('lost promise') }),
    );
    expect(errorLedgerCount()).toBe(1);
    expect(readErrorLedger()[0].kind).toBe('unhandled-rejection');
  });
});

describe('D. window.onerror-class error', () => {
  test('records exactly one entry', () => {
    window.dispatchEvent(
      new ErrorEvent('error', { message: 'window boom', error: new Error('window boom') }),
    );
    expect(errorLedgerCount()).toBe(1);
    expect(readErrorLedger()[0].kind).toBe('window-error');
  });
});

describe('E. failed API call through apiFetch', () => {
  test('a 5xx records one entry with status, method and path — and no body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { code: 'BOOM', message: 'errors.generic' } }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    const res = await apiFetch('/api/journeys?wishPrice=3000', {
      method: 'POST',
      body: JSON.stringify({ pickupName: 'Kimironko market' }),
    });
    expect(res.status).toBe(503);

    await waitFor(() => expect(errorLedgerCount()).toBe(1));
    const [entry] = readErrorLedger();
    expect(entry.kind).toBe('api-server');
    expect(entry.status).toBe(503);
    expect(entry.method).toBe('POST');
    // Query string stripped, body absent.
    expect(entry.path).toBe('/api/journeys');
    expect(JSON.stringify(entry)).not.toContain('Kimironko');
    expect(JSON.stringify(entry)).not.toContain('wishPrice');
  });

  test('a request that never got a response records one network entry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    await expect(apiFetch('/api/journeys', { method: 'GET' })).rejects.toThrow();
    expect(errorLedgerCount()).toBe(1);
    const [entry] = readErrorLedger();
    expect(entry.kind).toBe('api-network');
    expect(entry.path).toBe('/api/journeys');
    expect(entry.status).toBeUndefined();
  });

  test('an aborted request records nothing — we cancelled it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        throw err;
      }),
    );
    await expect(apiFetch('/api/geocode/search', { method: 'GET' })).rejects.toThrow();
    expect(errorLedgerCount()).toBe(0);
  });

  test('a 4xx is a real answer, not a fault, and is not recorded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 403 })),
    );
    const res = await apiFetch('/api/journeys', { method: 'GET' });
    expect(res.status).toBe(403);
    expect(errorLedgerCount()).toBe(0);
  });
});
