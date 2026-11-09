import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AdminConflictDecideModal } from '../AdminConflictDecideModal';
import { ADMIN_REASON_MIN_LENGTH } from '@bimoto/shared';

function makeOk(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as any;
}

function makeErr(status: number, body: unknown) {
  return { ok: false, status, json: async () => body } as any;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const baseProps = {
  conflictType: 'JOURNEY_RECONCILIATION',
  conflictId: 'abcdef1234567890',
  validDecisions: [
    'RESOLVED_REFUND',
    'RESOLVED_PAY',
    'RESOLVED_SPLIT',
    'NO_ACTION',
  ],
  onSuccess: vi.fn(),
  onCancel: vi.fn(),
};

describe('AdminConflictDecideModal', () => {
  test('renders one radio per validDecision', () => {
    render(<AdminConflictDecideModal {...baseProps} onSuccess={vi.fn()} onCancel={vi.fn()} />);
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(baseProps.validDecisions.length);
    for (const d of baseProps.validDecisions) {
      // each decision code is shown in its label (font-mono row).
      expect(screen.getByText(d)).toBeInTheDocument();
    }
  });

  test('submit button disabled when no decision selected', () => {
    render(<AdminConflictDecideModal {...baseProps} onSuccess={vi.fn()} onCancel={vi.fn()} />);
    const submit = screen.getByRole('button', { name: /Submit decision/i });
    expect(submit).toBeDisabled();
    // Even with a long-enough reason, no decision == disabled.
    fireEvent.change(screen.getByPlaceholderText(/Explain why/i), {
      target: { value: 'A reason long enough to clear the floor' },
    });
    expect(submit).toBeDisabled();
  });

  test('submit button disabled when reason is below the minimum', () => {
    render(<AdminConflictDecideModal {...baseProps} onSuccess={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByLabelText(/RESOLVED_REFUND/i));
    fireEvent.change(screen.getByPlaceholderText(/Explain why/i), {
      target: { value: 'short' },
    });
    expect(screen.getByRole('button', { name: /Submit decision/i })).toBeDisabled();
  });

  test('submit button enabled once decision selected and reason ≥ min length', () => {
    render(<AdminConflictDecideModal {...baseProps} onSuccess={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByLabelText(/NO_ACTION/i));
    fireEvent.change(screen.getByPlaceholderText(/Explain why/i), {
      target: { value: 'x'.repeat(ADMIN_REASON_MIN_LENGTH) },
    });
    expect(screen.getByRole('button', { name: /Submit decision/i })).toBeEnabled();
  });

  test('clicking submit calls fetch with the correct URL and trimmed body, then onSuccess', async () => {
    const fetchMock = vi.fn(async () => makeOk({ adminAction: { id: 'aa-1' } }));
    (globalThis as any).fetch = fetchMock;
    const onSuccess = vi.fn();

    render(<AdminConflictDecideModal {...baseProps} onSuccess={onSuccess} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByLabelText(/RESOLVED_REFUND/i));
    fireEvent.change(screen.getByPlaceholderText(/Explain why/i), {
      target: { value: '  a sufficiently long reason here  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Submit decision/i }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(
      /\/api\/admin\/conflicts\/JOURNEY_RECONCILIATION\/abcdef1234567890\/decide$/,
    );
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      decision: 'RESOLVED_REFUND',
      reason: 'a sufficiently long reason here',
    });
  });

  test('renders the server error code when the decide endpoint returns non-200', async () => {
    const fetchMock = vi.fn(async () =>
      makeErr(400, { error: { code: 'DECISION_NOT_VALID_FOR_TYPE' } }),
    );
    (globalThis as any).fetch = fetchMock;
    const onSuccess = vi.fn();

    render(<AdminConflictDecideModal {...baseProps} onSuccess={onSuccess} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByLabelText(/NO_ACTION/i));
    fireEvent.change(screen.getByPlaceholderText(/Explain why/i), {
      target: { value: 'long enough reason text' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Submit decision/i }));

    await waitFor(() =>
      expect(screen.getByText(/DECISION_NOT_VALID_FOR_TYPE/)).toBeInTheDocument(),
    );
    expect(onSuccess).not.toHaveBeenCalled();
  });

  test('cancel button invokes onCancel', () => {
    const onCancel = vi.fn();
    render(<AdminConflictDecideModal {...baseProps} onSuccess={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/ }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
