// NET-UX G1 — React binding for the connectivity source of truth.
//
// Composes the existing useNetworkStatus hook (device-level signal:
// @capacitor/network on native, navigator.onLine on web) with
// sync/connectivity.ts (API-level signal: apiFetch outcomes + the
// backoff health probe). This hook is the only bridge between the two —
// components never talk to the module directly, and no parallel
// connectivity store exists.

import { useEffect, useState } from 'react';
import { useNetworkStatus } from './useNetworkStatus';
import {
  getConnectionState,
  onConnectionStateChange,
  reportNetworkStatus,
  type ConnectionState,
} from '../sync/connectivity';

export type { ConnectionState };

/**
 * Subscribe to the unified connection state. Safe to call from many
 * components — the underlying module supports multiple listeners and
 * reportNetworkStatus is idempotent.
 */
export function useConnectionState(): ConnectionState {
  const network = useNetworkStatus();
  const [state, setState] = useState<ConnectionState>(getConnectionState);

  useEffect(() => {
    reportNetworkStatus(network.connected);
  }, [network.connected]);

  useEffect(() => {
    setState(getConnectionState());
    return onConnectionStateChange(setState);
  }, []);

  return state;
}
