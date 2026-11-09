// NOTIFY G4 — the Bimoto sound.
//
// Faustin's ask (24 Aug, Confirmation card): a motari riding with the
// phone in his pocket has to know something happened WITHOUT looking.
//
// TWO PROMISES ARE UNDER TEST HERE and the second matters more than the
// first. One: the two variants really are different — critical is the
// motif twice, louder, so it survives a pocket and an engine. Two:
// FAILURE IS SILENCE. A device with no AudioContext, a context that
// refuses to resume, a browser that throws on createOscillator — every
// one of them must end in a sound that did not play and a toast that
// did. A notification that cannot make a noise is a notification; a
// notification that throws is a bug, and it is the toast that would be
// lost.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  SOUND_PATTERNS,
  playNotificationSound,
  notificationSoundsEnabled,
  installSoundUnlock,
  __resetNotificationSoundForTest,
} from '../lib/notification-sound';
import { PREF_KEYS } from '../hooks/usePreferences';

/** A minimal AudioContext double that records what was scheduled. */
function mockAudio(opts: { state?: string; throwOn?: 'ctor' | 'oscillator' } = {}) {
  const started: Array<{ freq: number; start: number; stop: number; gain: number }> = [];
  const ctor = vi.fn(function (this: unknown) {
    if (opts.throwOn === 'ctor') throw new Error('no audio on this device');
    return {
      state: opts.state ?? 'running',
      currentTime: 0,
      destination: {},
      resume: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
      createOscillator() {
        if (opts.throwOn === 'oscillator') throw new Error('oscillator unavailable');
        const node = {
          type: '',
          frequency: { value: 0 },
          connect: vi.fn(),
          start: (t: number) => {
            started.push({ freq: node.frequency.value, start: t, stop: 0, gain: 0 });
          },
          stop: (t: number) => {
            if (started.length) started[started.length - 1].stop = t;
          },
        };
        return node;
      },
      createGain() {
        return {
          gain: {
            setValueAtTime: vi.fn(),
            exponentialRampToValueAtTime: (v: number) => {
              if (started.length && v > started[started.length - 1].gain) {
                started[started.length - 1].gain = v;
              }
            },
          },
          connect: vi.fn(),
        };
      },
    };
  });
  vi.stubGlobal('AudioContext', ctor as never);
  return { started, ctor };
}

beforeEach(() => {
  __resetNotificationSoundForTest();
  window.localStorage.removeItem(PREF_KEYS.notificationSounds);
});

afterEach(() => {
  vi.unstubAllGlobals();
  __resetNotificationSoundForTest();
  window.localStorage.removeItem(PREF_KEYS.notificationSounds);
});

describe('the motif', () => {
  test('both variants are the same rising two-tone gesture', () => {
    const [lowS, highS] = SOUND_PATTERNS.standard;
    expect(highS.freq).toBeGreaterThan(lowS.freq);
    const [lowC, highC] = SOUND_PATTERNS.critical;
    expect(lowC.freq).toBe(lowS.freq);
    expect(highC.freq).toBe(highS.freq);
  });

  test('critical is longer, louder, and plays the motif TWICE', () => {
    expect(SOUND_PATTERNS.critical).toHaveLength(4);
    expect(SOUND_PATTERNS.standard).toHaveLength(2);
    expect(SOUND_PATTERNS.critical[0].gain).toBeGreaterThan(SOUND_PATTERNS.standard[0].gain);
    const endOf = (p: typeof SOUND_PATTERNS.standard) =>
      Math.max(...p.map((t) => t.at + t.duration));
    expect(endOf(SOUND_PATTERNS.critical)).toBeGreaterThan(endOf(SOUND_PATTERNS.standard));
  });
});

describe('variant → what is actually scheduled', () => {
  test('standard schedules two tones', () => {
    const { started } = mockAudio();
    expect(playNotificationSound('standard')).toBe(true);
    expect(started).toHaveLength(2);
    expect(started[1].freq).toBeGreaterThan(started[0].freq);
  });

  test('critical schedules four, at a higher gain', () => {
    const { started } = mockAudio();
    expect(playNotificationSound('critical')).toBe(true);
    expect(started).toHaveLength(4);
    expect(started[0].gain).toBeGreaterThan(SOUND_PATTERNS.standard[0].gain);
  });

  test('the default variant is standard — the passenger’s, per Faustin’s sub-question', () => {
    const { started } = mockAudio();
    playNotificationSound();
    expect(started).toHaveLength(SOUND_PATTERNS.standard.length);
  });
});

describe('failure is silence, never an exception', () => {
  test('no AudioContext at all: returns false, throws nothing', () => {
    vi.stubGlobal('AudioContext', undefined as never);
    vi.stubGlobal('webkitAudioContext', undefined as never);
    expect(() => playNotificationSound('critical')).not.toThrow();
    expect(playNotificationSound('critical')).toBe(false);
  });

  test('a constructor that throws is swallowed', () => {
    mockAudio({ throwOn: 'ctor' });
    expect(playNotificationSound('standard')).toBe(false);
  });

  test('an audio graph that throws mid-schedule is swallowed', () => {
    mockAudio({ throwOn: 'oscillator' });
    expect(() => playNotificationSound('standard')).not.toThrow();
    expect(playNotificationSound('standard')).toBe(false);
  });

  test('a suspended context is nudged and still schedules — never throws', () => {
    const { started } = mockAudio({ state: 'suspended' });
    expect(() => playNotificationSound('standard')).not.toThrow();
    expect(started.length).toBeGreaterThan(0);
  });
});

describe('the Settings toggle', () => {
  test('unset means ON — the documented default, not a silence nobody chose', () => {
    expect(notificationSoundsEnabled()).toBe(true);
  });

  test("only the explicit string 'false' silences it", () => {
    window.localStorage.setItem(PREF_KEYS.notificationSounds, 'true');
    expect(notificationSoundsEnabled()).toBe(true);
    window.localStorage.setItem(PREF_KEYS.notificationSounds, 'false');
    expect(notificationSoundsEnabled()).toBe(false);
  });

  test('OFF schedules nothing at all — the audio graph is never touched', () => {
    window.localStorage.setItem(PREF_KEYS.notificationSounds, 'false');
    const { started, ctor } = mockAudio();
    expect(playNotificationSound('critical')).toBe(false);
    expect(started).toHaveLength(0);
    expect(ctor).not.toHaveBeenCalled();
  });
});

describe('unlock on first gesture', () => {
  test('registers one-shot listeners and removes them when one fires', () => {
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    mockAudio({ state: 'suspended' });
    installSoundUnlock();

    const events = add.mock.calls.map((c) => c[0]);
    expect(events).toEqual(expect.arrayContaining(['pointerdown', 'touchstart', 'keydown']));

    const unlock = add.mock.calls[0][1] as EventListener;
    expect(() => unlock(new Event('pointerdown'))).not.toThrow();
    // All three come off together — the context only needs unlocking once.
    expect(remove.mock.calls.map((c) => c[0])).toEqual(
      expect.arrayContaining(['pointerdown', 'touchstart', 'keydown']),
    );
    add.mockRestore();
    remove.mockRestore();
  });

  test('a device that cannot unlock does not throw on the first tap', () => {
    mockAudio({ throwOn: 'ctor' });
    const add = vi.spyOn(document, 'addEventListener');
    installSoundUnlock();
    const unlock = add.mock.calls[0][1] as EventListener;
    expect(() => unlock(new Event('pointerdown'))).not.toThrow();
    add.mockRestore();
  });
});
