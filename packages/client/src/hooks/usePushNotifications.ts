import { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import {
  PushNotifications,
  type Token,
  type PushNotificationSchema,
  type ActionPerformed,
} from '@capacitor/push-notifications';
import { useNavigate } from 'react-router-dom';
import { useUIStore } from '../stores/ui.store';
import { apiFetch } from '../lib/api';

export type PushPlatform = 'IOS' | 'ANDROID';

export interface PushDeepLinkData {
  type?: 'bid' | 'journey' | 'message' | 'escrow' | 'rating' | 'admin-conflict';
  journeyId?: string;
  bidId?: string;
  legId?: string;
  conflictType?: string;
  deepLink?: string;
  [k: string]: unknown;
}

function detectPlatform(): PushPlatform | null {
  const p = Capacitor.getPlatform();
  if (p === 'ios') return 'IOS';
  if (p === 'android') return 'ANDROID';
  return null;
}

// PUSH-CRASH G1 — capability gate for the native push flow.
//
// On Android, PushNotifications.register() invokes Firebase Cloud
// Messaging on the NATIVE main thread. In a build without Firebase
// config (no google-services.json — the default; build.gradle only
// applies the google-services plugin when the file exists), the native
// call throws IllegalStateException("Default FirebaseApp is not
// initialized") and the PROCESS crashes. The JS try/catch around the
// flow below cannot catch a native-thread throw, so it is NOT a
// sufficient guard on its own — the only safe fix is to never reach
// requestPermissions()/register() unless this build actually armed
// push. Two layers, neither of which can itself throw:
//
//   1. VITE_PUSH_ENABLED — compile-time flag baked at build, default
//      OFF. Read at call time (not module scope) so tests can stub it.
//   2. Capacitor.isPluginAvailable('PushNotifications') — runtime
//      check that the plugin is registered with the bridge; a plain
//      boolean lookup, wrapped defensively anyway.
//
// Flipping push on later is a config change (set VITE_PUSH_ENABLED=true
// and ship a real google-services.json), not a code change.
export function isPushAvailable(): boolean {
  if (import.meta.env.VITE_PUSH_ENABLED !== 'true') return false;
  try {
    return Capacitor.isPluginAvailable('PushNotifications');
  } catch {
    return false;
  }
}

async function postToken(token: string, platform: PushPlatform): Promise<void> {
  try {
    await apiFetch(`/api/push/register`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, platform }),
    });
  } catch (err) {
    console.warn('[push] failed to POST token:', (err as Error).message);
  }
}

async function deletePushToken(token: string): Promise<void> {
  try {
    await apiFetch(`/api/push/register`, {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
  } catch (err) {
    console.warn('[push] failed to DELETE token:', (err as Error).message);
  }
}

function pathForDeepLink(data: PushDeepLinkData): string | null {
  // R3-CONFLICTS-NOTIFICATIONS — admin push for a new recipient dispute
  // (conflictType === 'CONFLICT_RECIPIENT_DISPUTE') deep-links straight
  // to the per-conflict detail page so ops can act in seconds.
  if (data.type === 'admin-conflict' && typeof data.deepLink === 'string' && data.deepLink) {
    return data.deepLink;
  }
  if (data.journeyId && data.type === 'message') return `/journey/${data.journeyId}/chat`;
  if (data.journeyId) return `/journey/${data.journeyId}/progress`;
  return null;
}

interface PushHandle {
  token: string | null;
  deregister: () => Promise<void>;
}

const handle: PushHandle = {
  token: null,
  deregister: async () => {
    if (!Capacitor.isNativePlatform()) return;
    // Push was never armed in this build → no listeners/token exist and
    // the plugin must not be touched (see isPushAvailable()).
    if (!isPushAvailable()) return;
    await PushNotifications.removeAllListeners();
    if (handle.token) {
      await deletePushToken(handle.token);
      handle.token = null;
    }
  },
};

// Imperative deregister entry point so the auth store's logout flow can
// tear down push without coupling to React state.
export async function deregisterPush(): Promise<void> {
  await handle.deregister();
}

export function usePushNotifications(userId: string | null | undefined): void {
  const navigate = useNavigate();
  const showToast = useUIStore((s) => s.showToast);
  const activeUserRef = useRef<string | null>(null);

  useEffect(() => {
    if (!userId) {
      activeUserRef.current = null;
      return;
    }
    if (!Capacitor.isNativePlatform()) return;
    // PUSH-CRASH G1 — bail out BEFORE any plugin call when this build
    // didn't arm push. The try/catch below stays as a second layer but
    // cannot catch the native-thread throw register() produces in a
    // Firebase-less build; this early return is the real crash guard.
    if (!isPushAvailable()) return;
    const platform = detectPlatform();
    if (!platform) return;

    activeUserRef.current = userId;
    let cancelled = false;

    (async () => {
      try {
        const perm = await PushNotifications.requestPermissions();
        if (perm.receive !== 'granted') {
          // User declined the OS prompt — silently fall back. The user
          // can enable it later from Settings; we don't pester them.
          return;
        }
        if (cancelled) return;

        await PushNotifications.addListener('registration', (token: Token) => {
          handle.token = token.value;
          void postToken(token.value, platform);
        });

        await PushNotifications.addListener(
          'pushNotificationReceived',
          (notification: PushNotificationSchema) => {
            const title = notification.title ?? '';
            const body = notification.body ?? '';
            const text = [title, body].filter(Boolean).join(' — ') || 'New notification';
            showToast(text, 'info');
          },
        );

        await PushNotifications.addListener(
          'pushNotificationActionPerformed',
          (action: ActionPerformed) => {
            const data = (action.notification?.data ?? {}) as PushDeepLinkData;
            const path = pathForDeepLink(data);
            if (path) navigate(path);
          },
        );

        await PushNotifications.addListener('registrationError', (err) => {
          console.warn('[push] registration error:', err.error);
        });

        await PushNotifications.register();
      } catch (err) {
        console.warn('[push] init failed:', (err as Error).message);
      }
    })();

    return () => {
      cancelled = true;
      void PushNotifications.removeAllListeners();
    };
  }, [userId, navigate, showToast]);
}
