import { useState } from 'react';
import { ADMIN_REASON_MIN_LENGTH } from '@bimoto/shared';
import { apiFetch } from '../../lib/api';

const DECISION_LABELS: Record<string, string> = {
  RESOLVED_REFUND: 'Refund customer (full)',
  RESOLVED_PAY: 'Pay driver (full)',
  RESOLVED_SPLIT: 'Split escrow (50/50)',
  UPHOLD_FLAG: 'Uphold the flag (action stands)',
  OVERTURN_FLAG: 'Overturn the flag (clear the user)',
  FORCE_COMPLETE: 'Force complete (escrow → driver)',
  NO_ACTION: 'No action (close without consequence)',
};

interface AdminConflictDecideModalProps {
  conflictType: string;
  conflictId: string;
  validDecisions: string[];
  onSuccess: () => void;
  onCancel: () => void;
}

export function AdminConflictDecideModal({
  conflictType,
  conflictId,
  validDecisions,
  onSuccess,
  onCancel,
}: AdminConflictDecideModalProps) {
  const [decision, setDecision] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reasonValid = reason.trim().length >= ADMIN_REASON_MIN_LENGTH;
  const canSubmit = decision !== null && reasonValid && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch(
        `/api/admin/conflicts/${conflictType}/${conflictId}/decide`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ decision, reason: reason.trim() }),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error?.code || 'DECIDE_FAILED');
      }
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Failed to record decision');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-lg max-w-lg w-full p-6">
        <h2 className="text-xl font-bold mb-4">Decide conflict</h2>
        <p className="text-sm text-gray-600 mb-4">
          Type: <span className="font-mono">{conflictType}</span> · ID:{' '}
          <span className="font-mono">{conflictId.slice(0, 8)}…</span>
        </p>
        <fieldset className="mb-4">
          <legend className="text-sm font-semibold mb-2">Decision</legend>
          <div className="space-y-2">
            {validDecisions.map((d) => (
              <label
                key={d}
                className="flex items-start gap-2 cursor-pointer p-2 rounded hover:bg-gray-50"
              >
                <input
                  type="radio"
                  name="decision"
                  value={d}
                  checked={decision === d}
                  onChange={() => setDecision(d)}
                  className="mt-1"
                />
                <div>
                  <div className="font-medium">{DECISION_LABELS[d] ?? d}</div>
                  <div className="text-xs text-gray-500 font-mono">{d}</div>
                </div>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="block mb-4">
          <span className="text-sm font-semibold">
            Reason (required, min {ADMIN_REASON_MIN_LENGTH} chars)
          </span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="mt-1 w-full border rounded p-2 text-sm"
            rows={3}
            placeholder="Explain why you are making this decision (will be stored in the audit chain)"
          />
          <span
            className={`text-xs ${
              reasonValid ? 'text-green-700' : 'text-gray-500'
            }`}
          >
            {reason.trim().length} / {ADMIN_REASON_MIN_LENGTH} chars
          </span>
        </label>
        {error && (
          <div className="mb-4 p-2 bg-red-50 text-red-700 text-sm rounded">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={submitting}
            className="px-4 py-2 border rounded hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? 'Recording...' : 'Submit decision'}
          </button>
        </div>
      </div>
    </div>
  );
}
