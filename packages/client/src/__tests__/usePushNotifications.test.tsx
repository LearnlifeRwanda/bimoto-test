import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

// Mocks must be registered before importing the hook.
const isNativeRef = { value: true };
const platformRef = { value: 'ios' as 'ios' | 'android' | 'web' };
const pluginAvailableRef = { value: true };
type PermState = 'granted' | 'denied' | 'prompt';
const requestPermissions: any = vi.fn(async () => ({ receive: 'granted' as PermState }));
const register: any = vi.fn(async () => undefined);
const removeAllListeners: any = vi.fn(async () => undefined);
type Listener = { event: string; cb: (...args: any[]) => unknown };
const listeners: Listener[] = [];
const addListener: any = vi.fn(async (event: string, cb: (...args: any[]) => unknown) => {
  listeners.push({ event, cb });
});

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => isNativeRef.value,
    getPlatform: () => platformRef.value,
    isPluginAvailable: (name: string) =>
      name === 'PushNotifications' ? pluginAvailableRef.value : false,
  },
}));

vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    requestPermissions: (a: any) => requestPermissions(a),
    register: (a: any) => register(a),
    addListener: (e: string, cb: any) => addListener(e, cb),
    removeAllListeners: () => removeAllListeners(),
  },
}));

const navigate = vi.fn();
vi.mock('react-router-dom', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    useNavigate: () => navigate,
  };
});

vi.mock('../stores/ui.store', () => ({
  useUIStore: (selector: (s: any) => any) => selector({ showToast: vi.fn() }),
}));

import { usePushNotifications, deregisterPush } from '../hooks/usePushNotifications';

const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));

beforeEach(() => {
  vi.clearAllMocks();
  // PUSH-CRASH G1 — the gate defaults OFF; these tests exercise the
  // enabled path, so arm it explicitly. Gate-off behaviour has its own
  // describe block below.
  vi.stubEnv('VITE_PUSH_ENABLED', 'true');
  pluginAvailableRef.value = true;
  isNativeRef.value = true;
  platformRef.value = 'ios';
  requestPermissions.mockResolvedValue({ receive: 'granted' });
  register.mockResolvedValue(undefined);
  removeAllListeners.mockResolvedValue(undefined);
  listeners.length = 0;
  (global as any).fetch = fetchMock;
  fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function wrapper({ children }: { children: React.ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

async function flushAllListeners() {
  // The hook installs listeners asynchronously (`await addListener`).
  // Wait for them to be wired before invoking.
  await waitFor(() => {
    expect(addListener.mock.calls.length).toBeGreaterThanOrEqual(4);
  });
}

describe('usePushNotifications — native iOS, permission granted', () => {
  test('requests permissions, registers, and POSTs the device token', async () => {
    renderHook(() => usePushNotifications('user-1'), { wrapper });
    await flushAllListeners();

    // Trigger the registration listener as if APNS had handed us a token.
    const reg = listeners.find((l) => l.event === 'registration')!;
    reg.cb({ value: 'apns-token-abc' });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/api/push/register');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      token: 'apns-token-abc',
      platform: 'IOS',
    });
    expect(register).toHaveBeenCalled();
  });
});

describe('usePushNotifications — permission denied', () => {
  test('does not register or POST when user declines OS prompt', async () => {
    requestPermissions.mockResolvedValueOnce({ receive: 'denied' });
    renderHook(() => usePushNotifications('user-1'), { wrapper });

    await waitFor(() => expect(requestPermissions).toHaveBeenCalled());
    expect(register).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('usePushNotifications — web platform', () => {
  test('is a no-op on web (no native API calls, no fetch)', async () => {
    isNativeRef.value = false;
    platformRef.value = 'web';
    renderHook(() => usePushNotifications('user-1'), { wrapper });

    // Give async work a chance to run if it would.
    await new Promise((r) => setTimeout(r, 5));
    expect(requestPermissions).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('usePushNotifications — deep linking', () => {
  test('navigates to /journey/:id/progress on tap with journeyId', async () => {
    renderHook(() => usePushNotifications('user-1'), { wrapper });
    await flushAllListeners();

    const action = listeners.find((l) => l.event === 'pushNotificationActionPerformed')!;
    action.cb({
      notification: { data: { type: 'bid', journeyId: 'j-42' } },
    });
    expect(navigate).toHaveBeenCalledWith('/journey/j-42/progress');
  });

  test('navigates to chat for message-type pushes', async () => {
    renderHook(() => usePushNotifications('user-1'), { wrapper });
    await flushAllListeners();

    const action = listeners.find((l) => l.event === 'pushNotificationActionPerformed')!;
    action.cb({
      notification: { data: { type: 'message', journeyId: 'j-7' } },
    });
    expect(navigate).toHaveBeenCalledWith('/journey/j-7/chat');
  });

  test('does nothing when tap payload has no journeyId', async () => {
    renderHook(() => usePushNotifications('user-1'), { wrapper });
    await flushAllListeners();

    const action = listeners.find((l) => l.event === 'pushNotificationActionPerformed')!;
    action.cb({ notification: { data: {} } });
    expect(navigate).not.toHaveBeenCalled();
  });

  // R3-CONFLICTS-NOTIFICATIONS — admin-side push for a new recipient
  // dispute. The server fires `type: 'admin-conflict'` with a deepLink
  // pointing at /admin/conflicts/RECIPIENT_DISPUTE/:legId so tapping
  // jumps the admin straight to the per-conflict detail page.
  test('navigates to the admin conflict detail page on admin-conflict deep-link tap', async () => {
    renderHook(() => usePushNotifications('user-1'), { wrapper });
    await flushAllListeners();

    const action = listeners.find((l) => l.event === 'pushNotificationActionPerformed')!;
    action.cb({
      notification: {
        data: {
          type: 'admin-conflict',
          conflictType: 'CONFLICT_RECIPIENT_DISPUTE',
          legId: 'leg-42',
          deepLink: '/admin/conflicts/RECIPIENT_DISPUTE/leg-42',
        },
      },
    });
    expect(navigate).toHaveBeenCalledWith('/admin/conflicts/RECIPIENT_DISPUTE/leg-42');
  });

  test('does not navigate when admin-conflict payload is missing deepLink', async () => {
    renderHook(() => usePushNotifications('user-1'), { wrapper });
    await flushAllListeners();

    const action = listeners.find((l) => l.event === 'pushNotificationActionPerformed')!;
    action.cb({
      notification: {
        data: { type: 'admin-conflict', legId: 'leg-42' },
      },
    });
    expect(navigate).not.toHaveBeenCalled();
  });
});

// PUSH-CRASH G1/G4 — the capability gate. In a build that didn't arm
// push (flag off or plugin absent), the hook must never touch the
// plugin: on Android, register() without Firebase config crashes the
// process natively, past any JS catch.
describe('usePushNotifications — capability gate (push disabled)', () => {
  test('VITE_PUSH_ENABLED unset/false → no plugin call at all on native', async () => {
    vi.stubEnv('VITE_PUSH_ENABLED', 'false');
    platformRef.value = 'android';
    renderHook(() => usePushNotifications('user-1'), { wrapper });

    await new Promise((r) => setTimeout(r, 5));
    expect(requestPermissions).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
    expect(addListener).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('plugin not available → no plugin call even with the flag on', async () => {
    pluginAvailableRef.value = false;
    platformRef.value = 'android';
    renderHook(() => usePushNotifications('user-1'), { wrapper });

    await new Promise((r) => setTimeout(r, 5));
    expect(requestPermissions).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
    expect(addListener).not.toHaveBeenCalled();
  });

  test('deregisterPush is a no-op when push was never armed', async () => {
    vi.stubEnv('VITE_PUSH_ENABLED', 'false');
    await deregisterPush();
    expect(removeAllListeners).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('flag on + plugin available → listeners are wired (Android)', async () => {
    platformRef.value = 'android';
    renderHook(() => usePushNotifications('user-1'), { wrapper });
    await flushAllListeners();
    expect(requestPermissions).toHaveBeenCalled();
    expect(register).toHaveBeenCalled();
    const events = listeners.map((l) => l.event);
    expect(events).toEqual(
      expect.arrayContaining([
        'registration',
        'pushNotificationReceived',
        'pushNotificationActionPerformed',
        'registrationError',
      ]),
    );
  });
});

describe('usePushNotifications — null userId', () => {
  test('does not call native APIs when no user is logged in', async () => {
    renderHook(() => usePushNotifications(null), { wrapper });
    await new Promise((r) => setTimeout(r, 5));
    expect(requestPermissions).not.toHaveBeenCalled();
  });
});

describe('deregisterPush', () => {
  test('removes listeners and DELETEs the token (once registered)', async () => {
    renderHook(() => usePushNotifications('user-1'), { wrapper });
    await flushAllListeners();
    const reg = listeners.find((l) => l.event === 'registration')!;
    reg.cb({ value: 'apns-token-xyz' });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    fetchMock.mockClear();

    await deregisterPush();

    expect(removeAllListeners).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/api/push/register');
    expect(init.method).toBe('DELETE');
    expect(JSON.parse(init.body as string)).toEqual({ token: 'apns-token-xyz' });
  });
});
