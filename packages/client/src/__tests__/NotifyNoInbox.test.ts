// NOTIFY — D9's ruling, pinned.
//
// "NO inbox. That question goes back to the field only after they have
// lived with real notifications." (founder + team, 20 Aug.)
//
// A toast stack is exactly one refactor away from becoming an inbox, and
// the refactor is a small one: add a Dexie table, or keep the array
// across a navigation, and the thing you have is a notification centre
// nobody decided to build. This file is the tripwire. It reads source
// rather than behaviour, because what it is defending against is a
// future edit, not a current bug.
//
// It also pins the OTHER half of the sound contract — a sound that
// cannot play must never cost the toast — because that is the only
// place where a failure in G4 could silently remove news from G3.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { useUIStore } from '../stores/ui.store';

const SRC = join(__dirname, '..');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__' || entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\./.test(entry)) out.push(full);
  }
  return out;
}

const rel = (f: string) => relative(SRC, f).split('\\').join('/');

describe('no inbox — nothing about a notification is persisted', () => {
  test('the toast stack is declared in ui.store and nowhere else', () => {
    const owners = sourceFiles(SRC)
      .filter((f) => /toasts\s*:\s*Toast\[\]/.test(readFileSync(f, 'utf8')))
      .map(rel);
    expect(owners).toEqual(['stores/ui.store.ts']);
  });

  test('ui.store never writes a toast to durable storage', () => {
    // The store DOES persist the language pref, and always has. What it
    // must never persist is anything toast-shaped, so the assertion is
    // per-WRITE rather than per-file: every durable write in this file
    // is inspected, and none of them may mention a toast.
    const store = readFileSync(join(SRC, 'stores/ui.store.ts'), 'utf8');
    const writes = store
      .split('\n')
      .filter((line) => /prefs\.set\(|localStorage|setItem\(|\bdb\.\w+\.(put|add|bulk)/.test(line));
    expect(writes.length).toBeGreaterThan(0); // the language pref, still there
    for (const line of writes) expect(line).not.toMatch(/toast/i);
  });

  test('the Dexie schema declares no notification or inbox table', () => {
    // The real invariant, read off the real schema rather than guessed
    // at with a keyword grep over prose. Every table this app has ever
    // declared is in one file, in version() blocks; a notification store
    // would have to appear here, and it does not.
    const schema = readFileSync(join(SRC, 'db/dexie.ts'), 'utf8');
    const tables = [...schema.matchAll(/^\s{4,}(\w+)\s*:\s*'/gm)].map((m) => m[1]);
    expect(tables.length).toBeGreaterThan(5); // the walk still sees the schema
    const offenders = tables.filter((t) => /notification|inbox|toast|alert/i.test(t));
    expect(offenders).toEqual([]);
  });

  test('the stack really is plain in-memory state: clearing it leaves nothing', () => {
    useUIStore.getState().showToast('news', 'info', 'notification');
    expect(useUIStore.getState().toasts).toHaveLength(1);
    useUIStore.getState().hideToast();
    expect(useUIStore.getState().toasts).toEqual([]);
    // A fresh read of the store — the only place a reload could look —
    // has nothing to restore from.
    expect(useUIStore.getState().toastMessage).toBeNull();
  });
});

describe('a sound that cannot play never costs the toast', () => {
  beforeEach(() => {
    useUIStore.getState().hideToast();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    useUIStore.getState().hideToast();
  });

  test('with audio flatly unavailable, the notification still renders in full', async () => {
    vi.stubGlobal('AudioContext', undefined as never);
    vi.stubGlobal('webkitAudioContext', undefined as never);
    const { playNotificationSound } = await import('../lib/notification-sound');

    // The order useSocket uses: toast first, sound second.
    useUIStore.getState().showToast('You were paid 4,200 RWF', 'success', 'notification');
    expect(() => playNotificationSound('critical')).not.toThrow();

    const toast = useUIStore.getState().toasts[0];
    expect(toast.message).toBe('You were paid 4,200 RWF');
    expect(toast.toastClass).toBe('notification');
  });
});
