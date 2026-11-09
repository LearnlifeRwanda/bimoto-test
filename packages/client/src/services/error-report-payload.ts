// FLIGHT-RECORDER G2 — the ONE serializer.
//
// There are two ways an error report leaves this phone: the Send report
// button on the Diagnostics screen, and the consented background
// uploader (services/diagnostics-upload.ts). They must not be two
// formats, two caps or two ideas of what a "duplicate" is, because the
// Diagnostics screen's promise is that the user reads exactly the bytes
// that leave — and that promise is worthless if the button and the
// uploader disagree.
//
// So both call buildErrorReport(). The screen renders ITS output rather
// than the raw ring, which is what keeps the preview byte-accurate for
// both paths at once.
//
// What this module does NOT do is redact. Redaction already happened, at
// write time, inside the ledger (services/error-ledger.ts rule 2): a
// token is not filtered on the way out, it is unrepresentable in a
// stored entry. A second pass here would imply the first one needed
// backing up. What this module adds is grouping and bounds:
//
//   - a fingerprint per entry (@bimoto/shared), so the server can group
//     without parsing prose;
//   - collapse of identical entries into one row carrying `dup`, so an
//     error loop that fired forty times costs one row and still says
//     forty;
//   - the same hard entry cap the route enforces, with an explicit
//     marker row when anything was dropped. A silent truncation would
//     read as "that is all there was".

import { errorFingerprint } from '@bimoto/shared';
import type { ErrorLedgerEntry, ErrorLedgerKind } from './error-ledger';

/** Mirrors MAX_REPORT_ENTRIES in routes/diagnostics.routes.ts. The
 *  device ring is capped at the same number, so this only ever bites
 *  when a caller hands over something other than the ring. */
export const MAX_REPORT_ENTRIES = 50;

/** A payload row's kind. Every ledger kind, plus one this module
 *  synthesises and the ledger never stores — 'upload-dropped' describes
 *  the payload, not a fault the phone had. */
export type ErrorReportKind = ErrorLedgerKind | 'upload-dropped';

export interface ErrorReportEntry extends Omit<ErrorLedgerEntry, 'kind'> {
  kind: ErrorReportKind;
  /** Stable grouping key. The server recomputes its own and stores that;
   *  this copy is what the client dedupes on before sending. */
  fp: string;
  /** How many identical entries this row stands for. Absent when 1. */
  dup?: number;
}

export interface ErrorReportBody {
  entries: ErrorReportEntry[];
}

/** The synthetic row that says something did not fit. Shaped like a
 *  ledger entry so the route stores it unchanged and the admin export
 *  shows it in line with the rest. */
function droppedMarker(count: number, template: ErrorReportEntry | undefined): ErrorReportEntry {
  return {
    t: template?.t ?? Date.now(),
    build: template?.build ?? 'unknown',
    route: template?.route ?? '',
    kind: 'upload-dropped',
    message: `${count} older entries dropped before upload (report cap)`,
    fp: errorFingerprint({ kind: 'upload-dropped', message: 'entries dropped' }),
  };
}

/**
 * Build the exact body that goes on the wire, from ledger entries in
 * display order (newest first — readErrorLedger()'s order).
 *
 * Deduplication keeps the NEWEST occurrence of each fingerprint, because
 * the newest one carries the route and timestamp closest to what the
 * user was doing when they noticed.
 */
export function buildErrorReport(entries: ErrorLedgerEntry[]): ErrorReportBody {
  const byFingerprint = new Map<string, ErrorReportEntry>();
  for (const entry of entries) {
    const fp = errorFingerprint({
      kind: entry.kind,
      message: entry.message,
      stack: entry.stack,
    });
    const seen = byFingerprint.get(fp);
    if (seen) {
      seen.dup = (seen.dup ?? 1) + 1;
    } else {
      byFingerprint.set(fp, { ...entry, fp });
    }
  }

  const collapsed = [...byFingerprint.values()];
  if (collapsed.length <= MAX_REPORT_ENTRIES) return { entries: collapsed };

  // Newest first, so the tail is the oldest — the right thing to lose.
  const kept = collapsed.slice(0, MAX_REPORT_ENTRIES - 1);
  return { entries: [...kept, droppedMarker(collapsed.length - kept.length, collapsed[0])] };
}

/** The bytes themselves. Both send paths use this, so "what the screen
 *  shows" and "what the uploader posts" cannot drift apart. */
export function serializeErrorReport(entries: ErrorLedgerEntry[]): string {
  return JSON.stringify(buildErrorReport(entries));
}
