// NET-UX G2 — the ONE place API failures become user-facing words.
//
// Pages and hooks never invent error prose: they catch, optionally
// queue (offline-first flows), and hand the error here. The mapping is
// the taxonomy in lib/api.ts:
//   OFFLINE / UNREACHABLE → what the user can DO: "we'll keep your
//     request ready" where the call site queued, "check your connection"
//     where it could not. The G1 banner is already up (apiFetch reported
//     the failure) and owns the retrying story.
//   SERVER   → "Bimoto has a problem, not your phone" — never blames
//     the user's input or connection for a 5xx.
//   REJECTED → the server's own localized message: the body's i18n key
//     (e.g. 'errors.notJourneyCustomer') rendered when the client knows
//     it; unknown keys and prose bodies fall back to a generic-but-
//     honest "not accepted", never to a connection excuse.
//   AUTH     → session expired (apiFetch has already routed to logout).

import i18n from 'i18next';
import { useUIStore } from '../stores/ui.store';
import { ApiError } from './api';

export interface PresentApiErrorOptions {
  /** The call site saved the user's request in the offline queue. */
  queued?: boolean;
}

// Server message keys are dot-paths ('errors.notJourneyCustomer');
// legacy prose bodies ("Journey not found") never match this shape, so
// they can't be mistakenly fed to t().
const I18N_KEY_SHAPE = /^[\w]+(\.[\w]+)+$/;

function connectivityToast(queued: boolean): void {
  const { showToast } = useUIStore.getState();
  if (queued) {
    showToast(i18n.t('errors.offlineQueued'), 'info');
  } else {
    showToast(i18n.t('errors.offlineRetry'), 'error');
  }
}

export function presentApiError(err: unknown, opts: PresentApiErrorOptions = {}): void {
  const { showToast } = useUIStore.getState();
  const queued = opts.queued ?? false;

  if (err instanceof ApiError) {
    switch (err.kind) {
      case 'OFFLINE':
      case 'UNREACHABLE':
        connectivityToast(queued);
        return;
      case 'SERVER':
        showToast(i18n.t('errors.serverProblem'), 'error');
        return;
      case 'AUTH':
        showToast(i18n.t('errors.unauthorized'), 'error');
        return;
      case 'REJECTED': {
        const key = err.messageKey;
        if (key && I18N_KEY_SHAPE.test(key) && i18n.exists(key)) {
          showToast(i18n.t(key), 'error');
        } else {
          showToast(i18n.t('errors.rejectedGeneric'), 'error');
        }
        return;
      }
    }
  }

  // Raw fetch network failures from the pre-auth allowlisted call sites
  // (login OTP, public driver check) arrive as TypeError, not ApiError —
  // those must read as connection trouble, never as raw text.
  if (err instanceof TypeError) {
    connectivityToast(queued);
    return;
  }

  showToast(i18n.t('errors.generic'), 'error');
}

/** Toast for offline-first branches that queued WITHOUT a failed
 * request first (the caller already knew it was offline). */
export function showOfflineQueuedToast(): void {
  useUIStore.getState().showToast(i18n.t('errors.offlineQueued'), 'info');
}
