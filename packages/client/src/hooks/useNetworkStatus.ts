import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Network, type ConnectionStatus, type ConnectionType } from '@capacitor/network';

export type ConnectionTypeName = ConnectionType | 'unknown';

export interface NetworkState {
  connected: boolean;
  connectionType: ConnectionTypeName;
}

function initialState(): NetworkState {
  if (typeof navigator === 'undefined') {
    return { connected: true, connectionType: 'unknown' };
  }
  return { connected: navigator.onLine, connectionType: 'unknown' };
}

/**
 * Subscribe to network connectivity changes.
 *
 * - On native, uses @capacitor/network for richer info (cellular vs.
 *   wifi vs. unknown; survives WebView going to the background).
 * - On web, falls back to navigator.onLine and the window
 *   online/offline events (connectionType is always 'unknown').
 *
 * The hook is safe to call from many components — Capacitor and the
 * browser both support multiple listeners.
 */
export function useNetworkStatus(): NetworkState {
  const [state, setState] = useState<NetworkState>(initialState);

  useEffect(() => {
    let cancelled = false;

    if (Capacitor.isNativePlatform()) {
      // PUSH-CRASH G3 — both plugin promises need rejection handlers:
      // a device where the Network plugin misbehaves must degrade to
      // the navigator.onLine initial state, not throw unhandled at boot.
      Network.getStatus()
        .then((s: ConnectionStatus) => {
          if (cancelled) return;
          setState({ connected: s.connected, connectionType: s.connectionType ?? 'unknown' });
        })
        .catch(() => { /* keep initial navigator.onLine state */ });
      const handlerPromise = Network.addListener(
        'networkStatusChange',
        (s: ConnectionStatus) => {
          setState({ connected: s.connected, connectionType: s.connectionType ?? 'unknown' });
        },
      );
      handlerPromise.catch(() => { /* no listener — state updates stop, app keeps running */ });
      return () => {
        cancelled = true;
        handlerPromise.then((h) => h.remove()).catch(() => { /* swallow */ });
      };
    }

    if (typeof window === 'undefined') {
      return () => {
        cancelled = true;
      };
    }

    const update = () =>
      setState({ connected: navigator.onLine, connectionType: 'unknown' });
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      cancelled = true;
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  return state;
}
