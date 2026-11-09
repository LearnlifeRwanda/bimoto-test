// TEAM-SAID G4 — the auto-bid rules screen: built, and dark.
//
// Five of seven voted to build this and keep it off (item 12). The
// server has carried the rules API since Dispatch K2 with no client
// able to reach it; this screen reaches it.
//
// What is worth proving, in order of how much it matters:
//   1. no client path can arm a rule — the POST body carries
//      enabled: false, and resume-all is not callable;
//   2. the screen says out loud that auto-bid is off, so a driver who
//      writes five rules is not waiting for bids that cannot come;
//   3. the cap is enforced in the UI, before the route has to say no;
//   4. create, list, delete and pause-all reach the real endpoints.

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { i18n } from './setup';

import { AutoBidRulesPage } from '../pages/driver/AutoBidRulesPage';
import {
  AUTO_BID_PILOT_ENABLED,
  MAX_AUTO_BID_RULES,
} from '../hooks/useDriverAutoBid';
import { useAuthStore } from '../stores/auth.store';

const ENDPOINT = '/api/driver/auto-bid-rules';

function makeRule(priority: number, over: Record<string, unknown> = {}) {
  return {
    id: `rule-${priority}`,
    driverId: 'd1',
    priority,
    enabled: false,
    maxPickupDistanceM: 3000,
    maxRideDistanceM: 10000,
    vehicleTypeFilter: null,
    bidAmountMode: 'FLAT',
    bidAmountValue: 1500,
    createdAt: '2026-08-12T00:00:00.000Z',
    updatedAt: '2026-08-12T00:00:00.000Z',
    ...over,
  };
}

/** Serves GET from a mutable list; records every write. */
function stubApi(initial: ReturnType<typeof makeRule>[] = []) {
  let rules = [...initial];
  const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    if (u.includes('/pause-all')) {
      const paused = rules.filter((r) => r.enabled).length;
      rules = rules.map((r) => ({ ...r, enabled: false }));
      return new Response(JSON.stringify({ paused }), { status: 200 });
    }
    if (u.includes('/resume-all')) {
      rules = rules.map((r) => ({ ...r, enabled: true }));
      return new Response(JSON.stringify({ resumed: rules.length }), { status: 200 });
    }
    if (u.includes(ENDPOINT) && method === 'POST') {
      const body = JSON.parse(init!.body as string);
      const created = makeRule(body.priority, body);
      rules.push(created);
      return new Response(JSON.stringify(created), { status: 201 });
    }
    if (u.includes(ENDPOINT) && method === 'DELETE') {
      const id = u.split('/').pop()!;
      rules = rules.filter((r) => r.id !== id);
      return new Response(null, { status: 204 });
    }
    return new Response(JSON.stringify(rules), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const writes = (m: ReturnType<typeof stubApi>, method: string) =>
  m.mock.calls.filter(([u, init]) => {
    if ((init as RequestInit)?.method !== method) return false;
    // pause-all / resume-all are POSTs too; "writes(POST)" means
    // rule creation, so the two kill-switch paths are excluded.
    const url = String(u);
    return !url.includes('/pause-all') && !url.includes('/resume-all');
  });

beforeEach(async () => {
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      common: { cancel: 'Cancel', back: 'Back' },
      autoBid: {
        title: 'Automatic bidding',
        intro: 'A rule tells Bimoto which jobs you would take.',
        offTitle: 'Automatic bidding is off during the pilot.',
        offBody: 'Nothing bids on your behalf until Bimoto turns this on.',
        noRules: 'You have not written any rules yet.',
        addRule: 'Write a rule',
        newRule: 'New rule',
        saveRule: 'Save rule',
        deleteRule: 'Delete this rule',
        ruleOrder: 'Rule {{n}}',
        stateActive: 'Active',
        stateWaiting: 'Saved, not active',
        capNote: 'You are using {{used}} of {{max}} rules.',
        atCap: 'You have all {{max}} rules. Delete one to write another.',
        pauseAll: 'Pause all my rules',
        resumeAll: 'Turn all my rules back on',
        resumeAllBlocked: 'Available once Bimoto turns automatic bidding on.',
        enabledLabel: 'Rule status when saved',
        maxPickupLabel: 'How far will you go to collect?',
        maxPickupHelp: 'Up to {{max}} km.',
        maxRideLabel: 'How long a job will you take?',
        maxRideHelp: 'Up to {{max}} km.',
        vehicleLabel: 'Which jobs?',
        vehicleAny: 'Any machine',
        vehicleMoto: 'Moto',
        vehicleBike: 'Bicycle',
        vehicleEmoto: 'Electric moto',
        vehicleEbike: 'Electric bicycle',
        amountModeLabel: 'What do you bid?',
        modeFlat: 'A fixed price',
        modePercent: 'A share of the fair price',
        amountFlatLabel: 'Your price',
        amountPercentLabel: 'Percent of the fair price',
        amountHelp: 'Between {{min}} and {{max}}.',
        summaryDistances: 'Up to {{pickupKm}} km to collect, jobs up to {{rideKm}} km.',
        summaryFlat: 'Bids {{amount}} RWF.',
        summaryPercent: 'Bids {{percent}}% of the fair price.',
        summaryVehicle: 'Machine: {{vehicle}}.',
      },
    },
    true,
    true,
  );
  await i18n.changeLanguage('en');
  useAuthStore.setState({ token: 'tok', user: { id: 'd1', role: 'DRIVER' } as any } as any);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/driver/auto-bid']}>
      <AutoBidRulesPage />
    </MemoryRouter>,
  );

async function openForm() {
  fireEvent.click(await screen.findByTestId('auto-bid-add-rule'));
  return screen.findByTestId('auto-bid-form');
}

describe('the screen ships off, and says so', () => {
  test('auto-bid is off for the pilot', () => {
    // The constant IS the guarantee. If someone flips it without
    // meaning to, this is the line that notices.
    expect(AUTO_BID_PILOT_ENABLED).toBe(false);
  });

  test('a banner states the feature is inactive before anything else', async () => {
    stubApi();
    renderPage();
    const banner = await screen.findByTestId('auto-bid-off-banner');
    expect(banner).toHaveTextContent('off during the pilot');
    expect(banner).toHaveTextContent('Nothing bids on your behalf');
  });

  test('a saved rule shows as saved-not-active, never as active', async () => {
    stubApi([makeRule(0)]);
    renderPage();
    await screen.findByTestId('auto-bid-rule-list');
    expect(screen.getByTestId('auto-bid-rule-state-rule-0')).toHaveTextContent(
      'Saved, not active',
    );
    expect(screen.getByTestId('auto-bid-rule-rule-0')).toHaveAttribute(
      'data-enabled',
      'false',
    );
  });
});

describe('no client path can arm a rule', () => {
  test('the created rule is posted with enabled: false', async () => {
    const api = stubApi();
    renderPage();
    await openForm();
    fireEvent.click(screen.getByTestId('auto-bid-save'));

    await waitFor(() => expect(writes(api, 'POST')).toHaveLength(1));
    const body = JSON.parse(writes(api, 'POST')[0][1]!.body as string);
    // The whole inert guarantee, in one assertion.
    expect(body.enabled).toBe(false);
  });

  test('resume-all is present but not callable', async () => {
    const api = stubApi([makeRule(0)]);
    renderPage();

    const resume = await screen.findByTestId('auto-bid-resume-all');
    expect(resume).toBeDisabled();
    expect(screen.getByTestId('auto-bid-resume-blocked-note')).toHaveTextContent(
      'Available once Bimoto turns automatic bidding on',
    );

    fireEvent.click(resume);
    // Nothing reached the endpoint that would arm every rule at once.
    await waitFor(() => {
      const hit = api.mock.calls.some(([u]) => String(u).includes('/resume-all'));
      expect(hit).toBe(false);
    });
  });

  test('no request the screen makes ever sends enabled: true', async () => {
    const api = stubApi([makeRule(0)]);
    renderPage();
    await screen.findByTestId('auto-bid-rule-list');

    fireEvent.click(screen.getByTestId('auto-bid-pause-all'));
    // pause-all refreshes the list, which swaps the spinner in and out.
    await waitFor(() => {
      expect(api.mock.calls.some(([u]) => String(u).includes('/pause-all'))).toBe(true);
    });
    await screen.findByTestId('auto-bid-rule-list');

    await openForm();
    fireEvent.click(screen.getByTestId('auto-bid-save'));

    await waitFor(() => expect(writes(api, 'POST')).toHaveLength(1));
    for (const [, init] of api.mock.calls) {
      const raw = (init as RequestInit)?.body;
      if (typeof raw !== 'string') continue;
      expect(JSON.parse(raw).enabled).not.toBe(true);
    }
  });
});

describe('rules, and the cap on them', () => {
  test('lists the rules the server returns', async () => {
    stubApi([makeRule(0), makeRule(1)]);
    renderPage();
    const list = await screen.findByTestId('auto-bid-rule-list');
    expect(list.querySelectorAll('li')).toHaveLength(2);
    expect(screen.getByTestId('auto-bid-cap-note')).toHaveTextContent(
      `2 of ${MAX_AUTO_BID_RULES}`,
    );
  });

  test('at five rules the form is closed and the cap is explained', async () => {
    stubApi(Array.from({ length: MAX_AUTO_BID_RULES }, (_, i) => makeRule(i)));
    renderPage();

    await screen.findByTestId('auto-bid-at-cap');
    expect(screen.getByTestId('auto-bid-at-cap')).toHaveTextContent(
      `all ${MAX_AUTO_BID_RULES} rules`,
    );
    // The driver never gets to compose a sixth and be rejected.
    expect(screen.queryByTestId('auto-bid-add-rule')).toBeNull();
    expect(screen.queryByTestId('auto-bid-form')).toBeNull();
  });

  test('a new rule takes the lowest free priority slot', async () => {
    const api = stubApi([makeRule(0), makeRule(2)]);
    renderPage();
    await screen.findByTestId('auto-bid-rule-list');
    await openForm();
    fireEvent.click(screen.getByTestId('auto-bid-save'));

    await waitFor(() => expect(writes(api, 'POST')).toHaveLength(1));
    const body = JSON.parse(writes(api, 'POST')[0][1]!.body as string);
    // 0 and 2 are taken, so 1 — not 3, which would leave a gap, and
    // not 0, which the route would reject as PRIORITY_TAKEN.
    expect(body.priority).toBe(1);
  });

  test('deleting a rule calls the route and refreshes', async () => {
    const api = stubApi([makeRule(0)]);
    renderPage();
    await screen.findByTestId('auto-bid-rule-list');

    fireEvent.click(screen.getByTestId('auto-bid-delete-rule-0'));
    await waitFor(() => expect(writes(api, 'DELETE')).toHaveLength(1));
    expect(String(writes(api, 'DELETE')[0][0])).toContain(`${ENDPOINT}/rule-0`);
  });

  test('pause-all round-trips against the route', async () => {
    const api = stubApi([makeRule(0, { enabled: true })]);
    renderPage();
    await screen.findByTestId('auto-bid-rule-list');

    fireEvent.click(screen.getByTestId('auto-bid-pause-all'));
    await waitFor(() => {
      expect(api.mock.calls.some(([u]) => String(u).includes('/pause-all'))).toBe(true);
    });
    await waitFor(() => {
      expect(screen.getByTestId('auto-bid-rule-rule-0')).toHaveAttribute(
        'data-enabled',
        'false',
      );
    });
  });
});

// FLIGHT-RECORDER G5.4 — the e-bike driver's own machine. The filter
// offered MOTO, BIKE and E_MOTO; E_BIKE is the fourth member of the
// shared VehicleType enum and was the only one this list never named, so
// an e-bike driver's options were three vehicles he does not ride, or
// "any machine".
describe('the vehicle filter names every machine the fleet has', () => {
  test('E_BIKE is offered alongside the other three', async () => {
    stubApi();
    renderPage();
    await openForm();

    for (const value of ['MOTO', 'BIKE', 'E_MOTO', 'E_BIKE']) {
      expect(screen.getByTestId(`auto-bid-vehicle-${value}`)).toBeInTheDocument();
    }
    expect(screen.getByText('Electric bicycle')).toBeInTheDocument();
  });

  test('choosing it sends the shared enum spelling, not a variant', async () => {
    const api = stubApi();
    renderPage();
    await openForm();

    fireEvent.change(screen.getByTestId('auto-bid-max-pickup'), { target: { value: '2' } });
    fireEvent.change(screen.getByTestId('auto-bid-max-ride'), { target: { value: '8' } });
    fireEvent.click(screen.getByTestId('auto-bid-vehicle-E_BIKE'));
    fireEvent.change(screen.getByTestId('auto-bid-amount'), { target: { value: '2000' } });
    fireEvent.click(screen.getByTestId('auto-bid-save'));

    await waitFor(() => expect(writes(api, 'POST')).toHaveLength(1));
    const body = JSON.parse(writes(api, 'POST')[0][1]!.body as string);
    expect(body.vehicleTypeFilter).toBe('E_BIKE');
  });

  test('"any machine" is still the default — adding one did not preselect it', async () => {
    const api = stubApi();
    renderPage();
    await openForm();

    fireEvent.change(screen.getByTestId('auto-bid-max-pickup'), { target: { value: '2' } });
    fireEvent.change(screen.getByTestId('auto-bid-max-ride'), { target: { value: '8' } });
    fireEvent.change(screen.getByTestId('auto-bid-amount'), { target: { value: '2000' } });
    fireEvent.click(screen.getByTestId('auto-bid-save'));

    await waitFor(() => expect(writes(api, 'POST')).toHaveLength(1));
    const body = JSON.parse(writes(api, 'POST')[0][1]!.body as string);
    expect(body.vehicleTypeFilter).toBeNull();
  });
});

describe('the form sends exactly what the route accepts', () => {
  test('every RuleInput field, and no field the server would strip', async () => {
    const api = stubApi();
    renderPage();
    await openForm();

    fireEvent.change(screen.getByTestId('auto-bid-max-pickup'), { target: { value: '2' } });
    fireEvent.change(screen.getByTestId('auto-bid-max-ride'), { target: { value: '8' } });
    fireEvent.click(screen.getByTestId('auto-bid-vehicle-MOTO'));
    fireEvent.change(screen.getByTestId('auto-bid-amount'), { target: { value: '2000' } });
    fireEvent.click(screen.getByTestId('auto-bid-save'));

    await waitFor(() => expect(writes(api, 'POST')).toHaveLength(1));
    const body = JSON.parse(writes(api, 'POST')[0][1]!.body as string);

    expect(Object.keys(body).sort()).toEqual(
      [
        'bidAmountMode',
        'bidAmountValue',
        'enabled',
        'maxPickupDistanceM',
        'maxRideDistanceM',
        'priority',
        'vehicleTypeFilter',
      ].sort(),
    );
    // km in the form, metres on the wire — the route's unit.
    expect(body.maxPickupDistanceM).toBe(2000);
    expect(body.maxRideDistanceM).toBe(8000);
    expect(body.vehicleTypeFilter).toBe('MOTO');
    expect(body.bidAmountMode).toBe('FLAT');
    expect(body.bidAmountValue).toBe(2000);
  });

  test('percent mode switches the bound and the unit', async () => {
    const api = stubApi();
    renderPage();
    await openForm();

    fireEvent.click(screen.getByTestId('auto-bid-mode-PERCENT_OF_FAIR_PRICE'));
    fireEvent.change(screen.getByTestId('auto-bid-amount'), { target: { value: '120' } });
    fireEvent.click(screen.getByTestId('auto-bid-save'));

    await waitFor(() => expect(writes(api, 'POST')).toHaveLength(1));
    const body = JSON.parse(writes(api, 'POST')[0][1]!.body as string);
    expect(body.bidAmountMode).toBe('PERCENT_OF_FAIR_PRICE');
    expect(body.bidAmountValue).toBe(120);
  });

  test('a value outside the route bounds cannot be submitted', async () => {
    const api = stubApi();
    renderPage();
    await openForm();

    // FLAT accepts 100..50000; 60000 would be INVALID_AMOUNT.
    fireEvent.change(screen.getByTestId('auto-bid-amount'), { target: { value: '60000' } });
    expect(screen.getByTestId('auto-bid-save')).toBeDisabled();

    // 11 km pickup exceeds the 10 km ceiling.
    fireEvent.change(screen.getByTestId('auto-bid-amount'), { target: { value: '1500' } });
    fireEvent.change(screen.getByTestId('auto-bid-max-pickup'), { target: { value: '11' } });
    expect(screen.getByTestId('auto-bid-save')).toBeDisabled();

    expect(writes(api, 'POST')).toHaveLength(0);
  });
});
