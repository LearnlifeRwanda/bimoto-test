// PROFILE-RESCUE G3 — the recovery ladder.
//
//   1. Retry: in-app reset + re-enter at the home route (no reload).
//   2. Crash loop (retry lands straight back in a crash): a labelled
//      "clear cached data" rung that drops rebuildable Dexie state
//      (offline map, cached rides) and NEVER the auth session or the
//      unsent syncEvents/gpsBuffer queues.
//   3. Only after a cache-clear retry also failed: a labelled
//      "log out and start over" choice.
import 'fake-indexeddb/auto';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { useAuthStore } from '../stores/auth.store';
import { db } from '../db/dexie';

let armed = true;
function Bomb(): React.ReactElement {
  if (armed) throw new Error('screen exploded');
  return <p>healthy app</p>;
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  armed = true;
  window.history.replaceState(null, '', '/profile');
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  useAuthStore.setState({
    user: {
      id: 'user-1',
      nickname: 'Test',
      role: 'DRIVER',
      language: 'en',
      idVerified: false,
      licenseVerified: false,
      completedRides: 0,
      cancellationCount: 0,
      totalRequests: 0,
    },
    isAuthenticated: true,
    isLoading: false,
    token: 'tok',
  });
});

afterEach(async () => {
  consoleErrorSpy.mockRestore();
  window.history.replaceState(null, '', '/');
  await db.journeys.clear();
  await db.syncEvents.clear();
});

describe('ErrorBoundary recovery ladder (PROFILE-RESCUE G3)', () => {
  test('retry leaves the crashed route: URL is reset to the home route', () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    expect(window.location.pathname).toBe('/profile');
    armed = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(window.location.pathname).toBe('/');
    expect(screen.getByText('healthy app')).toBeInTheDocument();
  });

  test('crash loop climbs the ladder: clear-caches rung, then labelled logout rung', async () => {
    await db.journeys.put({ id: 'j1' } as never);
    await db.syncEvents.put({ clientEventId: 'e1', synced: 0 } as never);

    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );

    // First crash: only Retry is offered.
    expect(screen.queryByTestId('boundary-clear-caches')).not.toBeInTheDocument();

    // Retry → immediate re-crash = crash loop → level 2 appears.
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByTestId('boundary-clear-caches')).toBeInTheDocument();
    // Level 3 is NOT offered before the cache clear was tried.
    expect(screen.queryByTestId('boundary-logout-reset')).not.toBeInTheDocument();

    // Level 2: clears rebuildable state, keeps session + unsent queue.
    fireEvent.click(screen.getByTestId('boundary-clear-caches'));
    // The clear recovers in-app; the still-armed bomb re-crashes,
    // which unlocks the labelled level-3 rung.
    expect(await screen.findByTestId('boundary-logout-reset')).toBeInTheDocument();

    await waitFor(async () => {
      expect(await db.journeys.count()).toBe(0);
    });
    expect(await db.syncEvents.count()).toBe(1); // unsent events survive
    expect(useAuthStore.getState().isAuthenticated).toBe(true); // never silent logout
    expect(useAuthStore.getState().token).toBe('tok');

    // The ladder never dead-ends: once the fault clears, Retry recovers.
    armed = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(screen.getByText('healthy app')).toBeInTheDocument();
  });
});
