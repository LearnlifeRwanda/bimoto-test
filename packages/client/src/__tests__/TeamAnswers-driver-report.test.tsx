// TEAM-ANSWERS G3/G6 — the driver reports, and is never asked to grade.
//
// The component is mounted on the driver's ride receipt and on the
// parcel 'done' step; tested here on its own, because what matters is
// the promise it makes rather than which of the two screens it sits on.
//
// Pinned: it is a link, not a step; nothing is filed until a reason is
// chosen; the copy says out loud that the passenger is not scored and
// is not told who reported; and there is no star, score or number
// anywhere on the surface.

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { i18n } from './setup';
import enTranslation from '../../public/locales/en/translation.json';

import { ReportRideCard } from '../components/report/ReportRideCard';
import { useUIStore } from '../stores/ui.store';
import { _resetConnectivityForTests } from '../sync/connectivity';

beforeEach(async () => {
  _resetConnectivityForTests();
  useUIStore.setState({ toasts: [], toastMessage: null, toastType: null } as never);
  i18n.addResourceBundle('en', 'translation', enTranslation, true, true);
  await i18n.changeLanguage('en');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  _resetConnectivityForTests();
});

// The mock stands in for global fetch, so it carries fetch's own
// signature — both parameters, not just the ones this suite reads. A
// one-parameter implementation makes `mock.calls` a one-tuple, and every
// `calls[n][1]` a compile error the test runner never sees (vitest strips
// types, `tsc` checks them).
//
// `body` is narrowed to string because that is what this codebase
// actually sends: apiFetch serialises every body to JSON before it gets
// here. That is a statement about the app, not a convenience.
type JsonInit = RequestInit & { body?: string };
type FetchCall = [input: RequestInfo | URL, init?: JsonInit];

function stubFetch(response = { status: 201, body: { id: 'rr1' } }) {
  const mock = vi.fn(async (_input: RequestInfo | URL, _init?: JsonInit) =>
    new Response(JSON.stringify(response.body), { status: response.status }),
  );
  vi.stubGlobal('fetch', mock);
  return mock;
}

/** The JSON body of one recorded call, asserted present before parsing. */
function bodyOf(call: FetchCall | undefined) {
  const raw = call?.[1]?.body;
  expect(typeof raw).toBe('string');
  return JSON.parse(raw as string);
}

describe('TEAM-ANSWERS G3 — the driver reports a ride', () => {
  test('it opens as a link, not a form the driver has to dismiss', () => {
    stubFetch();
    render(<ReportRideCard journeyId="j1" />);

    expect(screen.getByTestId('report-ride-open')).toHaveTextContent(
      'Report a problem with this ride',
    );
    expect(screen.queryByTestId('report-ride-form')).not.toBeInTheDocument();
  });

  test('opening it offers the reasons and says what happens next', () => {
    stubFetch();
    render(<ReportRideCard journeyId="j1" />);
    fireEvent.click(screen.getByTestId('report-ride-open'));

    expect(screen.getByText('Passenger did not come, or kept me waiting')).toBeInTheDocument();
    expect(screen.getByText('Refused to pay the agreed price')).toBeInTheDocument();
    // The promise the whole substitution rests on, said out loud.
    expect(
      screen.getByText(
        'This goes to the Bimoto team to look at. The passenger is not scored, and is not told who reported.',
      ),
    ).toBeInTheDocument();
  });

  test('no stars, no score, no number anywhere on the surface', () => {
    stubFetch();
    const { container } = render(<ReportRideCard journeyId="j1" />);
    fireEvent.click(screen.getByTestId('report-ride-open'));

    // No star widget, no numeric input, nothing to grade with.
    expect(container.querySelectorAll('[role="radio"]')).toHaveLength(0);
    expect(container.querySelectorAll('input[type="number"]')).toHaveLength(0);
    expect(container.querySelectorAll('svg')).toHaveLength(0);
    expect(container.textContent).not.toMatch(/star|rating|\b[1-5]\s*\/\s*5\b/i);
    // "score" appears exactly once, and only in the sentence that says
    // there isn't one.
    const scoreMentions = (container.textContent ?? '').match(/scor\w*/gi) ?? [];
    expect(scoreMentions).toHaveLength(1);
    expect(container.textContent).toContain('The passenger is not scored');
  });

  test('nothing is filed until a reason is chosen', () => {
    const fetchMock = stubFetch();
    render(<ReportRideCard journeyId="j1" />);
    fireEvent.click(screen.getByTestId('report-ride-open'));

    expect(screen.getByTestId('report-ride-submit')).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('a reason alone files; details ride along when typed', async () => {
    const fetchMock = stubFetch();
    render(<ReportRideCard journeyId="j1" />);
    fireEvent.click(screen.getByTestId('report-ride-open'));

    fireEvent.change(screen.getByTestId('report-ride-reason'), {
      target: { value: 'UNSAFE_REQUEST' },
    });
    fireEvent.change(screen.getByTestId('report-ride-details'), {
      target: { value: 'asked me to carry three people' },
    });
    fireEvent.click(screen.getByTestId('report-ride-submit'));

    await waitFor(() => expect(screen.getByTestId('report-ride-done')).toBeInTheDocument());
    const call = fetchMock.mock.calls.at(0);
    expect(String(call?.[0])).toContain('/api/journeys/j1/report');
    expect(bodyOf(call)).toEqual({
      reason: 'UNSAFE_REQUEST',
      details: 'asked me to carry three people',
    });
  });

  test('untyped details are not sent as an empty string', async () => {
    const fetchMock = stubFetch();
    render(<ReportRideCard journeyId="j1" />);
    fireEvent.click(screen.getByTestId('report-ride-open'));
    fireEvent.change(screen.getByTestId('report-ride-reason'), {
      target: { value: 'OTHER' },
    });
    fireEvent.click(screen.getByTestId('report-ride-submit'));

    await waitFor(() => expect(screen.getByTestId('report-ride-done')).toBeInTheDocument());
    expect(bodyOf(fetchMock.mock.calls.at(0))).toEqual({
      reason: 'OTHER',
    });
  });

  test('cancelling closes it and files nothing', () => {
    const fetchMock = stubFetch();
    render(<ReportRideCard journeyId="j1" />);
    fireEvent.click(screen.getByTestId('report-ride-open'));
    fireEvent.click(screen.getByTestId('report-ride-cancel'));

    expect(screen.getByTestId('report-ride-open')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
