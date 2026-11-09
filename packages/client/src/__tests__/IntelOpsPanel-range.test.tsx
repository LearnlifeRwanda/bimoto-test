// __TESTS__/INTEL-OPS-PANEL-RANGE.TEST.TSX
//
// LOOSE-ENDS G6 — run-now takes a date range.
//
// The panel used to carry an honest sentence where a picker should have
// been: the endpoint took no range, so offering one would have offered a
// value the server ignored. Re-building last month's aggregates meant
// asking a developer.
//
// The two claims that matter here, in order of importance:
//
//   1. EMPTY IS THE DEFAULT, and it is byte-identical to before — one
//      button press, no body on the request, the job's own lookback
//      window. An admin who only ever wanted "run it now" must not
//      notice this dispatch happened.
//   2. A range is passed through, and the server's three rules are
//      mirrored so the common mistakes are caught before the round
//      trip. The cap comes from the server, not from a copy here.

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import './setup';
import i18n from 'i18next';
import enTranslation from '../../public/locales/en/translation.json';

const runAggregationNow = vi.fn();
const reloadTierConfig = vi.fn();

vi.mock('../lib/intel-api', async () => {
  const actual = await vi.importActual<typeof import('../lib/intel-api')>('../lib/intel-api');
  return {
    ...actual,
    runAggregationNow: (...args: unknown[]) => runAggregationNow(...args),
    reloadTierConfig: (...args: unknown[]) => reloadTierConfig(...args),
  };
});

import { IntelOpsPanel, validateRunNowRange } from '../components/intel/IntelOpsPanel';

// The real shipped English, so these assertions are about what an ops
// person reads rather than about key names.
i18n.addResourceBundle(
  'en',
  'translation',
  { intel: (enTranslation as Record<string, unknown>).intel },
  true,
  true,
);

function renderPanel(maxRunNowRangeDays: number | null = 90) {
  return render(
    <IntelOpsPanel
      config={null}
      classificationVersion={null}
      maxRunNowRangeDays={maxRunNowRangeDays}
      stats={null}
      onReloaded={vi.fn()}
    />,
  );
}

const setRange = (from: string, to: string) => {
  fireEvent.change(screen.getByTestId('intel-run-from'), { target: { value: from } });
  fireEvent.change(screen.getByTestId('intel-run-to'), { target: { value: to } });
};

beforeEach(async () => {
  vi.clearAllMocks();
  runAggregationNow.mockResolvedValue(undefined);
  await i18n.changeLanguage('en');
});

describe('validateRunNowRange — the server rules, mirrored', () => {
  test('both empty is the default run, not an error', () => {
    expect(validateRunNowRange('', '', 90)).toBeNull();
  });

  test('a half-specified range is refused', () => {
    expect(validateRunNowRange('2026-05-01', '', 90)).toBe('intel.ops.rangeIncomplete');
    expect(validateRunNowRange('', '2026-05-01', 90)).toBe('intel.ops.rangeIncomplete');
  });

  test('an unparseable bound is refused', () => {
    expect(validateRunNowRange('not-a-date', '2026-05-01', 90)).toBe('intel.ops.rangeUnparseable');
  });

  test('order is enforced, and a zero-length range is not a range', () => {
    expect(validateRunNowRange('2026-06-01', '2026-05-01', 90)).toBe('intel.ops.rangeOutOfOrder');
    expect(validateRunNowRange('2026-05-01', '2026-05-01', 90)).toBe('intel.ops.rangeOutOfOrder');
  });

  test('the cap is the SERVER-supplied one', () => {
    // 31 days: fine under 90, refused under 30.
    expect(validateRunNowRange('2026-05-01', '2026-06-01', 90)).toBeNull();
    expect(validateRunNowRange('2026-05-01', '2026-06-01', 30)).toBe('intel.ops.rangeTooLarge');
  });

  test('an unknown cap leaves the length to the server', () => {
    expect(validateRunNowRange('2020-01-01', '2026-01-01', null)).toBeNull();
  });
});

describe('the panel', () => {
  test('an empty range sends NO body — the request is what it always was', async () => {
    renderPanel();
    fireEvent.click(screen.getByTestId('intel-run-now'));

    await waitFor(() => expect(screen.getByTestId('intel-run-result')).toBeTruthy());
    expect(runAggregationNow).toHaveBeenCalledWith(undefined);
    expect(screen.getByTestId('intel-run-result').textContent).toContain(
      'the run is happening in the background',
    );
  });

  test('a filled range is passed through, and the result names it', async () => {
    renderPanel();
    setRange('2026-05-01', '2026-06-01');
    fireEvent.click(screen.getByTestId('intel-run-now'));

    await waitFor(() => expect(screen.getByTestId('intel-run-result')).toBeTruthy());
    expect(runAggregationNow).toHaveBeenCalledWith({
      dateFrom: '2026-05-01',
      dateTo: '2026-06-01',
    });
    expect(screen.getByTestId('intel-run-result').textContent).toContain('2026-05-01');
    expect(screen.getByTestId('intel-run-result').textContent).toContain('2026-06-01');
  });

  test('an invalid range is refused here, before the request', async () => {
    renderPanel();
    setRange('2026-06-01', '2026-05-01');
    fireEvent.click(screen.getByTestId('intel-run-now'));

    await waitFor(() => expect(screen.getByTestId('intel-run-range-error')).toBeTruthy());
    expect(screen.getByTestId('intel-run-range-error').textContent).toContain(
      'end date has to come after',
    );
    expect(runAggregationNow).not.toHaveBeenCalled();
    expect(screen.queryByTestId('intel-run-result')).toBeNull();
  });

  test('a half-filled range is refused before the request', async () => {
    renderPanel();
    fireEvent.change(screen.getByTestId('intel-run-from'), { target: { value: '2026-05-01' } });
    fireEvent.click(screen.getByTestId('intel-run-now'));

    await waitFor(() => expect(screen.getByTestId('intel-run-range-error')).toBeTruthy());
    expect(runAggregationNow).not.toHaveBeenCalled();
  });

  test('the cap message names the server-configured number of days', async () => {
    renderPanel(30);
    setRange('2026-05-01', '2026-07-01');
    fireEvent.click(screen.getByTestId('intel-run-now'));

    await waitFor(() => expect(screen.getByTestId('intel-run-range-error')).toBeTruthy());
    expect(screen.getByTestId('intel-run-range-error').textContent).toContain('30-day maximum');
    expect(runAggregationNow).not.toHaveBeenCalled();
  });

  test('clearing the range returns to the default run', async () => {
    renderPanel();
    setRange('2026-05-01', '2026-06-01');
    fireEvent.click(screen.getByTestId('intel-run-range-clear'));
    fireEvent.click(screen.getByTestId('intel-run-now'));

    await waitFor(() => expect(screen.getByTestId('intel-run-result')).toBeTruthy());
    expect(runAggregationNow).toHaveBeenCalledWith(undefined);
  });

  test('correcting a refused range clears the message and lets it through', async () => {
    renderPanel();
    setRange('2026-06-01', '2026-05-01');
    fireEvent.click(screen.getByTestId('intel-run-now'));
    await waitFor(() => expect(screen.getByTestId('intel-run-range-error')).toBeTruthy());

    setRange('2026-05-01', '2026-06-01');
    expect(screen.queryByTestId('intel-run-range-error')).toBeNull();

    fireEvent.click(screen.getByTestId('intel-run-now'));
    await waitFor(() => expect(screen.getByTestId('intel-run-result')).toBeTruthy());
    expect(runAggregationNow).toHaveBeenCalledWith({
      dateFrom: '2026-05-01',
      dateTo: '2026-06-01',
    });
  });

  test('a server refusal is still reported as a failed run', async () => {
    runAggregationNow.mockRejectedValueOnce(new Error('422'));
    renderPanel();
    setRange('2026-05-01', '2026-06-01');
    fireEvent.click(screen.getByTestId('intel-run-now'));

    await waitFor(() => expect(screen.getByTestId('intel-run-failed')).toBeTruthy());
  });

  test('the note tells an admin both halves of what the button now does', () => {
    renderPanel(90);
    const note = screen.getByText(/Leave the dates empty/);
    expect(note.textContent).toContain('nightly job');
    expect(note.textContent).toContain('90 days');
  });
});
