// NOTIFY G1 — the toast queue, at the store and at the screen.
//
// D9 (founder + team, 20 Aug) ruled two things about toasts and this
// file pins both: a notification lasts ~15 seconds, and a second one
// does not erase the first. Everything else here guards the promise
// that made the change safe to make — that form feedback behaves
// EXACTLY as it did before, because every existing call site passes two
// arguments and two arguments still mean "transient, 3 seconds".

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import React from 'react';
import '../i18n';
import { Toast } from '../components/ui/Toast';
import {
  MAX_TOASTS,
  MAX_VISIBLE_TOASTS,
  NOTIFICATION_TOAST_MS,
  TRANSIENT_TOAST_MS,
  TOAST_DURATIONS,
  useUIStore,
} from '../stores/ui.store';

const show = (...args: Parameters<ReturnType<typeof useUIStore.getState>['showToast']>) =>
  act(() => {
    useUIStore.getState().showToast(...args);
  });

beforeEach(() => {
  useUIStore.getState().hideToast();
});

afterEach(() => {
  useUIStore.getState().hideToast();
  vi.useRealTimers();
});

describe('the queue (store)', () => {
  test('a second toast STACKS instead of overwriting the first', () => {
    show('first', 'info');
    show('second', 'info');
    const { toasts } = useUIStore.getState();
    expect(toasts).toHaveLength(2);
    // Newest first.
    expect(toasts.map((t) => t.message)).toEqual(['second', 'first']);
  });

  test('the legacy toastMessage/toastType fields track the head of the stack', () => {
    show('first', 'info');
    expect(useUIStore.getState().toastMessage).toBe('first');
    show('second', 'error');
    expect(useUIStore.getState().toastMessage).toBe('second');
    expect(useUIStore.getState().toastType).toBe('error');
  });

  test('two arguments still mean transient — every pre-existing call site is unchanged', () => {
    show('Saved', 'success');
    expect(useUIStore.getState().toasts[0].toastClass).toBe('transient');
    expect(TOAST_DURATIONS.transient).toBe(TRANSIENT_TOAST_MS);
    expect(TRANSIENT_TOAST_MS).toBe(3_000);
  });

  test('the notification class carries D9’s ~15 seconds', () => {
    show('An offer arrived', 'info', 'notification');
    expect(useUIStore.getState().toasts[0].toastClass).toBe('notification');
    expect(TOAST_DURATIONS.notification).toBe(NOTIFICATION_TOAST_MS);
    expect(NOTIFICATION_TOAST_MS).toBe(15_000);
  });

  test('the stack is bounded, so a socket storm cannot grow it without limit', () => {
    for (let i = 0; i < MAX_TOASTS + 8; i++) show(`toast ${i}`, 'info', 'notification');
    expect(useUIStore.getState().toasts).toHaveLength(MAX_TOASTS);
    // The newest survive; the oldest fall off the end.
    expect(useUIStore.getState().toasts[0].message).toBe(`toast ${MAX_TOASTS + 7}`);
  });

  test('dismissToast removes exactly one, by id, leaving the rest', () => {
    show('a', 'info');
    show('b', 'info');
    show('c', 'info');
    const middle = useUIStore.getState().toasts[1];
    act(() => {
      useUIStore.getState().dismissToast(middle.id);
    });
    expect(useUIStore.getState().toasts.map((t) => t.message)).toEqual(['c', 'a']);
  });

  test('ids are unique across a clear, so a stale timer cannot dismiss a new toast', () => {
    show('a', 'info');
    const first = useUIStore.getState().toasts[0].id;
    act(() => useUIStore.getState().hideToast());
    show('b', 'info');
    expect(useUIStore.getState().toasts[0].id).not.toBe(first);
  });

  test('NOT PERSISTED — the stack is plain in-memory state (D9: no inbox)', () => {
    show('news', 'info', 'notification');
    // Nothing was written anywhere a reload could read back.
    expect(useUIStore.getState().toasts).toHaveLength(1);
    act(() => useUIStore.getState().hideToast());
    expect(useUIStore.getState().toasts).toEqual([]);
  });
});

describe('the stack (screen)', () => {
  test('two toasts render two alerts, newest on top', () => {
    render(<Toast />);
    show('older', 'info', 'notification');
    show('newer', 'info', 'notification');
    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(2);
    expect(alerts[0].textContent).toContain('newer');
    expect(alerts[1].textContent).toContain('older');
  });

  test('beyond the visible cap the overflow collapses to a "+N more" line', () => {
    render(<Toast />);
    for (let i = 0; i < MAX_VISIBLE_TOASTS + 3; i++) {
      show(`toast ${i}`, 'info', 'notification');
    }
    expect(screen.getAllByRole('alert')).toHaveLength(MAX_VISIBLE_TOASTS);
    expect(screen.getByTestId('toast-overflow').textContent).toContain('3');
  });

  test('each toast carries its own class on the DOM', () => {
    render(<Toast />);
    show('form feedback', 'success');
    show('news', 'info', 'notification');
    const items = screen.getAllByTestId('toast-item');
    expect(items[0].getAttribute('data-toast-class')).toBe('notification');
    expect(items[1].getAttribute('data-toast-class')).toBe('transient');
  });

  test('a transient toast expires at 3s while a notification is still on screen at 14s', () => {
    vi.useFakeTimers();
    render(<Toast />);
    show('news', 'info', 'notification');
    show('Saved', 'success');

    act(() => {
      vi.advanceTimersByTime(TRANSIENT_TOAST_MS + 50);
    });
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
    expect(screen.getByText('news')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(NOTIFICATION_TOAST_MS - TRANSIENT_TOAST_MS - 100);
    });
    // Still there at ~14.95s — this is the whole point of the class.
    expect(screen.getByText('news')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.queryByText('news')).not.toBeInTheDocument();
  });

  test('the per-toast close button dismisses only that toast', () => {
    render(<Toast />);
    show('keep me', 'info', 'notification');
    show('close me', 'info', 'notification');
    const items = screen.getAllByTestId('toast-item');
    fireEvent.click(items[0].querySelector('button')!);
    expect(screen.queryByText('close me')).not.toBeInTheDocument();
    expect(screen.getByText('keep me')).toBeInTheDocument();
  });

  test('an empty stack renders nothing at all', () => {
    const { container } = render(<Toast />);
    expect(container.firstChild).toBeNull();
  });
});
