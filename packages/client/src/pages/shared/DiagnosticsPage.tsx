import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { ErrorLogSection } from '../../components/diagnostics/ErrorLogSection';
import { useDiagnostics } from '../../hooks/useDiagnostics';
import { useErrorLedgerStore } from '../../services/error-ledger';
import { useSocket } from '../../hooks/useSocket';

// MATCH-CLOSE G4 — one screen that turns the next field report into
// evidence. Reachable in two taps (Profile → Diagnostics) and meant to
// be screenshotted and sent.
//
// Every value here is either a build id, a status code, a timestamp, a
// boolean, or a coordinate the app has already sent to the server. No
// tokens, no phone numbers, no secrets — this screen is designed to be
// photographed and shared over WhatsApp.

const fmtTime = (ts: number | null) => (ts === null ? '—' : new Date(ts).toLocaleTimeString());
const fmtBool = (v: boolean | null, y: string, n: string) => (v === null ? '—' : v ? y : n);

const Row: React.FC<{ label: string; value: string; testId: string }> = ({
  label,
  value,
  testId,
}) => (
  <div className="flex items-start justify-between gap-3 py-2 border-b border-gray-100 last:border-0">
    <span className="text-caption text-gray-500">{label}</span>
    <span
      className="text-caption font-mono text-gray-900 text-right break-all"
      data-testid={testId}
    >
      {value}
    </span>
  </div>
);

export const DiagnosticsPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // MATCH-CLOSE G4 — its own connection while open, so the "live
  // connection" row answers what the field asks (can this phone reach
  // the realtime channel now?) not what some other page last saw.
  useSocket();
  const d = useDiagnostics();
  // BLACKBOX G3 — one more number in the same discipline as the rows
  // above: how many errors this phone is currently holding.
  const errorCount = useErrorLedgerStore((s) => s.entries.length);

  const yes = t('common.yes');
  const no = t('common.no');

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-6">
      <div className="w-full max-w-sm mx-auto">
        <h1 className="text-heading font-bold text-gray-900 mb-1">
          {t('diagnostics.title')}
        </h1>
        <p className="text-caption text-gray-500 mb-4">{t('diagnostics.intro')}</p>

        <div className="bg-white rounded-xl shadow-sm p-4 mb-4" data-testid="diagnostics-panel">
          <Row label={t('diagnostics.appBuild')} value={d.appBuild} testId="diag-app-build" />
          <Row
            label={t('diagnostics.serverBuild')}
            value={d.serverBuild ?? '—'}
            testId="diag-server-build"
          />
          <Row
            label={t('diagnostics.buildsMatch')}
            value={fmtBool(d.buildsMatch, yes, no)}
            testId="diag-builds-match"
          />
          <Row label={t('diagnostics.role')} value={d.role ?? '—'} testId="diag-role" />
          <Row
            label={t('diagnostics.serverOnline')}
            value={fmtBool(d.serverOnline, yes, no)}
            testId="diag-server-online"
          />
          <Row
            label={t('diagnostics.socket')}
            value={fmtBool(d.socketConnected, yes, no)}
            testId="diag-socket"
          />
          {/* LIVE-WIRE G2 — degraded transport, named.

              "Connected" was true in Kigali whether the phone held a
              websocket or had silently fallen back to long-polling for
              the whole session, so a field report of "too slow" could
              not be told apart from a field report of "degraded". This
              row is what makes that answerable from a screenshot. */}
          <Row
            label={t('diagnostics.socketTransport')}
            value={
              d.socketTransport === null
                ? '—'
                : d.socketTransport === 'websocket'
                  ? t('diagnostics.transportWebsocket')
                  : t('diagnostics.transportPollingOnly', { transport: d.socketTransport })
            }
            testId="diag-socket-transport"
          />
          <Row
            label={t('diagnostics.feedViewAs')}
            value={d.lastFeedViewAs ?? '—'}
            testId="diag-feed-viewas"
          />
          <Row
            label={t('diagnostics.feedStatus')}
            value={
              d.lastFeedStatus === null
                ? '—'
                : `${d.lastFeedStatus} · ${fmtTime(d.lastFeedAt)}`
            }
            testId="diag-feed-status"
          />
          <Row
            label={t('diagnostics.lastLocation')}
            value={
              d.lastLocationAt === null
                ? '—'
                : `${d.lastLocationLat?.toFixed(4)}, ${d.lastLocationLng?.toFixed(4)} · ${fmtTime(
                    d.lastLocationAt,
                  )}`
            }
            testId="diag-last-location"
          />
          <Row
            label={t('diagnostics.errorCount')}
            value={String(errorCount)}
            testId="diag-error-count"
          />
        </div>

        {/* BLACKBOX G3 — the log itself, the consent sentence, and the
            only path off this device: a tap on Send report. */}
        <ErrorLogSection />

        <div className="flex gap-3">
          <Button fullWidth variant="secondary" onClick={() => navigate(-1)}>
            {t('common.back')}
          </Button>
          <Button fullWidth loading={d.isRefreshing} onClick={d.refresh}>
            {t('common.refresh')}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default DiagnosticsPage;
