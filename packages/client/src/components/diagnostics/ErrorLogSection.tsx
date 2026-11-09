import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/Button';
import { apiFetch } from '../../lib/api';
import {
  clearErrorLedger,
  readErrorLedger,
  useErrorLedgerStore,
} from '../../services/error-ledger';
import { buildErrorReport, type ErrorReportEntry } from '../../services/error-report-payload';

// BLACKBOX G3 — the half of the black box the user owns.
//
// Everything the ledger has recorded is shown here, in full, before any
// question of sending arises: the user reads exactly the bytes that
// would leave the phone. Then one button sends them.
//
// FLIGHT-RECORDER G2 revised the second half of that sentence and not
// the first. There is now a consented background upload
// (services/diagnostics-upload.ts) — stated at signup, switchable in
// Settings — and this button still works exactly as it did, whatever
// that switch says, because an explicit tap is its own consent.
//
// What did NOT change is the promise: the user reads exactly the bytes
// that leave. That is kept by rendering the SERIALIZER's output
// (error-report-payload.ts) rather than the raw ring — the same function
// the button and the uploader both post. If the payload collapses forty
// identical errors into one row saying "× 40", this list says "× 40"
// too, because it is the same list.
//
// The rows keep the Diagnostics discipline (DiagnosticsPage.tsx:12):
// a timestamp, a build id, a route, a kind, a status code. The only
// free text is the error's own message — already redacted and capped by
// the ledger before it was ever stored.

const fmtTime = (ts: number) => new Date(ts).toLocaleTimeString();

/** '—' | 'sent' | an HTTP status the server actually answered with. */
type SendState = 'idle' | 'sending' | { status: number } | 'failed';

const EntryRow: React.FC<{ entry: ErrorReportEntry }> = ({ entry }) => (
  <li
    className="py-2 border-b border-gray-100 last:border-0"
    data-testid="diag-error-entry"
  >
    <div className="flex items-start justify-between gap-3">
      <span className="text-caption font-mono text-gray-900">{entry.kind}</span>
      <span className="text-caption font-mono text-gray-500 text-right">
        {fmtTime(entry.t)}
        {entry.status === undefined ? '' : ` · ${entry.status}`}
        {entry.dup === undefined ? '' : ` · × ${entry.dup}`}
      </span>
    </div>
    <div className="text-caption font-mono text-gray-500 break-all">
      {entry.route || '/'}
      {entry.path ? ` · ${entry.method ?? ''} ${entry.path}` : ''}
      {` · ${entry.build}`}
    </div>
    <p className="text-caption font-mono text-gray-700 break-all mt-0.5">{entry.message}</p>
  </li>
);

export const ErrorLogSection: React.FC = () => {
  const { t } = useTranslation();
  // Subscribing to the store (rather than reading once) keeps the list
  // honest while the screen is open: an error that happens now appears
  // now, which is what makes the count worth trusting.
  useErrorLedgerStore((s) => s.entries);
  // The payload IS the preview. One call, one list, one set of bytes.
  const body = buildErrorReport(readErrorLedger());
  const entries = body.entries;
  const [send, setSend] = React.useState<SendState>('idle');

  const onSend = async () => {
    if (send === 'sending' || entries.length === 0) return;
    setSend('sending');
    try {
      // Written out in full rather than via a constant so the wiring
      // audit can see the call site (scripts/wiring-audit).
      const res = await apiFetch('/api/diagnostics/error-report', {
        method: 'POST',
        // Exactly the entries shown above — the same serializer output
        // the background uploader posts, and nothing of this
        // component's own.
        body: JSON.stringify(body),
      });
      setSend({ status: res.status });
    } catch {
      // Offline or unreachable. The ledger is untouched and the user can
      // tap again later; nothing was lost by trying.
      setSend('failed');
    }
  };

  const sendValue =
    send === 'idle'
      ? '—'
      : send === 'sending'
        ? '…'
        : send === 'failed'
          ? t('diagnostics.sendFailed')
          : `${send.status}`;

  return (
    <div className="bg-white rounded-xl shadow-sm p-4 mb-4" data-testid="diag-error-log">
      <h2 className="text-body font-bold text-gray-900 mb-1">{t('diagnostics.errorLog')}</h2>

      {entries.length === 0 ? (
        <p className="text-caption text-gray-500 py-2" data-testid="diag-error-log-empty">
          {t('diagnostics.errorLogEmpty')}
        </p>
      ) : (
        <ul className="mb-3">
          {entries.map((entry, i) => (
            <EntryRow key={`${entry.t}-${i}`} entry={entry} />
          ))}
        </ul>
      )}

      <p className="text-caption text-gray-500 mt-3 mb-3" data-testid="diag-error-consent">
        {t('diagnostics.sendConsent')}
      </p>

      {/* RIDE-TRACE G4 — the other thing this phone records, disclosed
          next to the one it already discloses. The sentence above ends
          with "your trips and your location are never part of it",
          which is true of the error report and would read as the whole
          truth if the trace were not named here too. The emergency
          follow is the exception to "never visible live", and it lives
          inside this same sentence: a screen that exists to say what
          this phone is doing cannot leave the reader to assemble one
          fact out of two paragraphs. */}
      <p className="text-caption text-gray-500 mb-3" data-testid="diag-ride-trace-note">
        {t('diagnostics.rideTraceNote')}
      </p>

      <div className="flex gap-3">
        <Button
          fullWidth
          onClick={() => void onSend()}
          loading={send === 'sending'}
          disabled={entries.length === 0}
          data-testid="diag-send-report"
        >
          {t('diagnostics.sendReport')}
        </Button>
        <Button
          fullWidth
          variant="secondary"
          onClick={() => {
            clearErrorLedger();
            setSend('idle');
          }}
          disabled={entries.length === 0}
          data-testid="diag-clear-log"
        >
          {t('diagnostics.clearLog')}
        </Button>
      </div>

      <div className="flex items-start justify-between gap-3 pt-3">
        <span className="text-caption text-gray-500">{t('diagnostics.sendStatus')}</span>
        <span
          className="text-caption font-mono text-gray-900 text-right break-all"
          data-testid="diag-send-status"
        >
          {sendValue}
        </span>
      </div>
    </div>
  );
};

export default ErrorLogSection;
