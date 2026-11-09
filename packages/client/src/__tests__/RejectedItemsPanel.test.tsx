import 'fake-indexeddb/auto';
import { describe, test, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { i18n } from './setup';
import { db } from '../db/dexie';
import { useAuthStore } from '../stores/auth.store';
import { RejectedItemsPanel } from '../components/sync/RejectedItemsPanel';

// CHROME-C G2 — was RejectedEventsBanner.test.tsx. The 45 px strip that
// used to displace every screen is gone; the list it opened onto is now
// a section of the status detail sheet, reached from the header badge.
// Every claim below is the original one, minus the strip's own count
// row (which is the badge's job and is asserted in
// ShellBandStability.test.tsx against the same Dexie queries).

i18n.addResourceBundle(
  'en',
  'translation',
  {
    sync: {
      banner: {
        failedCount_one: '{{count}} sync event failed — tap to review',
        failedCount_other: '{{count}} sync events failed — tap to review',
        modalTitle: 'Failed sync events',
        retry: 'Retry',
        discard: 'Discard',
        empty: 'No failed events.',
      },
      rejection: {
        FK_VIOLATION: 'Referenced item was deleted',
        UNKNOWN: 'Unknown error',
      },
    },
    common: { close: 'Close' },
  },
  true,
  true,
);

// QUEUE-UNITY G2 — the panel is scoped to the signed-in user, so these
// tests have to have one. VIEWER is whose phone this is; the seeds below
// are stamped as theirs unless a test says otherwise.
const VIEWER = 'user-viewer';

beforeEach(async () => {
  await db.syncEvents.clear();
  useAuthStore.setState({
    user: { id: VIEWER } as never,
    isAuthenticated: true,
  });
});

async function seed(events: Array<Partial<import('../db/tables').PendingSyncEvent>>) {
  for (const e of events) {
    await db.syncEvents.add({
      userId: e.userId !== undefined ? e.userId : VIEWER,
      clientEventId: e.clientEventId ?? 'id',
      eventType: e.eventType ?? 'JOURNEY_CREATED',
      payload: e.payload ?? {},
      clientTimestamp: e.clientTimestamp ?? '2026-05-06T12:00:00Z',
      synced: e.synced ?? false,
      failReason: e.failReason,
      journeyId: e.journeyId,
    });
  }
}

describe('RejectedItemsPanel — reads Dexie syncEvents.failReason', () => {
  test('renders nothing when no failed events exist', async () => {
    const { container } = render(<RejectedItemsPanel />);
    // Live query resolves async; assert it stays empty.
    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });

  test('shows count = 2 when two unsynced events have failReason set', async () => {
    await seed([
      {
        clientEventId: 'e1',
        eventType: 'JOURNEY_CREATED',
        failReason: 'FK_VIOLATION: Referenced item was deleted',
      },
      {
        clientEventId: 'e2',
        eventType: 'BID_PLACED',
        failReason: 'UNKNOWN: server explosion',
      },
    ]);

    render(<RejectedItemsPanel />);
    await waitFor(() => {
      // Both refusals are listed. The COUNT moved to the header badge;
      // what the panel owes is the items themselves.
      expect(screen.getByText('JOURNEY_CREATED')).toBeInTheDocument();
      expect(screen.getByText('BID_PLACED')).toBeInTheDocument();
    });
  });

  test('lists the rejection codes from Dexie, with both actions', async () => {
    await seed([
      {
        clientEventId: 'e-fk',
        eventType: 'JOURNEY_CREATED',
        failReason: 'FK_VIOLATION: Journey deleted',
      },
    ]);

    render(<RejectedItemsPanel />);
    await waitFor(() => screen.getByText('Referenced item was deleted'));

    expect(screen.getByText('Referenced item was deleted')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Discard' })).toBeInTheDocument();
  });

  test('Discard removes the event from Dexie', async () => {
    await seed([
      {
        clientEventId: 'e-discard',
        eventType: 'BID_PLACED',
        failReason: 'UNKNOWN: oops',
      },
    ]);

    render(<RejectedItemsPanel />);
    await waitFor(() => screen.getByRole('button', { name: 'Discard' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    });

    await waitFor(async () => {
      const rows = await db.syncEvents.toArray();
      expect(rows).toHaveLength(0);
    });
  });

  test('Retry clears failReason so SyncManager picks the event up again', async () => {
    await seed([
      {
        clientEventId: 'e-retry',
        eventType: 'BID_PLACED',
        failReason: 'UNKNOWN: transient',
      },
    ]);

    render(<RejectedItemsPanel />);
    await waitFor(() => screen.getByRole('button', { name: 'Retry' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    });

    await waitFor(async () => {
      const rows = await db.syncEvents.toArray();
      expect(rows).toHaveLength(1);
      expect(rows[0].failReason).toBeUndefined();
      expect(rows[0].synced).toBe(false);
    });
  });
});

// QUEUE-UNITY G2 — what the panel refuses to show.
describe('RejectedItemsPanel — a refusal is addressed to one person', () => {
  test("another user's refused event is not rendered", async () => {
    await seed([
      {
        userId: 'user-brother',
        clientEventId: 'e-theirs',
        eventType: 'JOURNEY_CREATED',
        failReason: 'FK_VIOLATION: Journey deleted',
      },
    ]);

    const { container } = render(<RejectedItemsPanel />);
    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
    expect(screen.queryByText('JOURNEY_CREATED')).not.toBeInTheDocument();
    // And it is still on the device, untouched. Not showing it is not
    // the same as throwing it away.
    expect(await db.syncEvents.count()).toBe(1);
  });

  test('a pre-v5 row (userId null) belongs to nobody and is shown to nobody', async () => {
    await seed([
      {
        userId: null,
        clientEventId: 'e-legacy',
        eventType: 'BID_PLACED',
        failReason: 'UNKNOWN: from before the stamp',
      },
    ]);

    const { container } = render(<RejectedItemsPanel />);
    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
    expect(await db.syncEvents.count()).toBe(1);
  });

  test("mine are shown even when a brother's sit beside them", async () => {
    await seed([
      { userId: 'user-brother', clientEventId: 'e-theirs', eventType: 'JOURNEY_CREATED', failReason: 'UNKNOWN: theirs' },
      { userId: null, clientEventId: 'e-legacy', eventType: 'GPS_BATCH', failReason: 'UNKNOWN: legacy' },
      { clientEventId: 'e-mine', eventType: 'BID_PLACED', failReason: 'UNKNOWN: mine' },
    ]);

    render(<RejectedItemsPanel />);
    await waitFor(() => screen.getByText('BID_PLACED'));

    expect(screen.getByText('BID_PLACED')).toBeInTheDocument();
    expect(screen.queryByText('JOURNEY_CREATED')).not.toBeInTheDocument();
    expect(screen.queryByText('GPS_BATCH')).not.toBeInTheDocument();
    // Exactly one item in the list, not three.
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  test('signed out, the panel shows nothing', async () => {
    await seed([{ clientEventId: 'e-mine', eventType: 'BID_PLACED', failReason: 'UNKNOWN: mine' }]);
    useAuthStore.setState({ user: null, isAuthenticated: false });

    const { container } = render(<RejectedItemsPanel />);
    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });
});
