// LIB/NOTIFICATION-SOUND.TS
//
// NOTIFY G4 — the Bimoto sound.
//
// Faustin's ask (24 Aug, Confirmation-of-Ride card): a unique, intense
// Bimoto notification sound, so a motari riding with the phone in his
// pocket knows something happened WITHOUT looking at the screen. A
// toast he has to see is no use to a man watching the road.
//
// WHY THIS IS SYNTHESIS AND NOT A FILE. Three standing constraints meet
// here and all three point the same way: no new dependency (standing),
// no audio asset enters the repo (so no licensing question to answer
// before a build the field is holding), and the APK has to stay small
// on a phone bought for 40,000 RWF. WebAudio is in the WebView on every
// Android target we ship to and in every desktop browser the pilot
// dashboard runs in, and an oscillator costs bytes rather than
// kilobytes. So the motif is DESCRIBED here, in numbers, and the device
// plays it.
//
// THE MOTIF. Two tones, rising — a perfect fifth, A5 → E6. Rising says
// "arrived", not "failed"; a fifth is the widest interval that still
// reads as one gesture rather than two unrelated beeps, and it survives
// a cheap phone speaker where a subtle interval turns to mush. That
// two-tone rise IS the Bimoto sound: one motif, two intensities.
//
//   'standard' — the passenger's, and everything not below. Short and
//                quiet: an offer arrived, a rating landed. She is
//                holding the phone; she does not need to be startled.
//   'critical' — the motari's. Longer, louder, and the motif plays
//                TWICE so it survives a pocket, an engine and a helmet.
//                Reserved for the four things that cost him money if he
//                misses them: a nearby request, his bid accepted, his
//                escrow released, an admin's verification decision.
//
// Faustin's open sub-question — should the passenger hear the same
// sound as the motari, or a softer one — is answered by that split, and
// the answer is: the same motif, softer. One brand, two intensities;
// nobody has to learn two sounds.
//
// FAILURE IS SILENCE, NEVER AN EXCEPTION. Every path here is wrapped.
// A browser with no AudioContext, a WebView that refuses to resume, a
// device on silent, an OS that killed the context in the background —
// all of them end in a sound that did not play and a toast that did.
// A notification that cannot make a noise is a notification; a
// notification that throws is a bug.

import { prefs, PREF_KEYS } from '../hooks/usePreferences';

export type SoundVariant = 'standard' | 'critical';

interface ToneSpec {
  /** Hz. */
  freq: number;
  /** Seconds from the start of the motif. */
  at: number;
  /** Seconds. */
  duration: number;
  /** Peak gain, 0..1. */
  gain: number;
}

// A5 (880) → E6 (1318.5): the rising fifth described above.
const LOW = 880;
const HIGH = 1318.51;

/**
 * The motif, per variant. Exported so the unit test can assert the
 * shape of what gets scheduled without owning a copy of these numbers.
 */
export const SOUND_PATTERNS: Record<SoundVariant, ToneSpec[]> = {
  standard: [
    { freq: LOW, at: 0, duration: 0.09, gain: 0.18 },
    { freq: HIGH, at: 0.1, duration: 0.13, gain: 0.18 },
  ],
  critical: [
    { freq: LOW, at: 0, duration: 0.1, gain: 0.42 },
    { freq: HIGH, at: 0.11, duration: 0.16, gain: 0.42 },
    // The repeat is what carries it out of a pocket.
    { freq: LOW, at: 0.34, duration: 0.1, gain: 0.42 },
    { freq: HIGH, at: 0.45, duration: 0.22, gain: 0.42 },
  ],
};

type AudioContextCtor = new () => AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

let ctx: AudioContext | null = null;

function context(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = audioContextCtor();
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
    return ctx;
  } catch {
    return null;
  }
}

/**
 * UNLOCK-ON-FIRST-GESTURE.
 *
 * Every browser and every Android WebView creates an AudioContext in
 * the 'suspended' state and refuses to resume it except inside a user
 * gesture. A notification is by definition NOT a gesture — it arrives
 * because a motari two kilometres away tapped something — so the very
 * first sound would be silently swallowed on every device unless the
 * context is resumed earlier, on some tap the user has already made.
 *
 * So: listen once for the first pointer/key/touch anywhere, resume the
 * context, and remove the listeners. From then on playback works from
 * a socket handler. Called from App boot; safe to call more than once.
 */
export function installSoundUnlock(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const events = ['pointerdown', 'touchstart', 'keydown'] as const;
  const unlock = () => {
    events.forEach((e) => document.removeEventListener(e, unlock));
    try {
      const c = context();
      if (c && c.state === 'suspended') void c.resume().catch(() => undefined);
    } catch {
      // A device that will not unlock simply stays silent.
    }
  };
  events.forEach((e) => document.addEventListener(e, unlock, { once: true, passive: true }));
}

/**
 * The user's "Notification sounds" preference (G4, Settings).
 *
 * Read SYNCHRONOUSLY, from the same localStorage cache every other
 * preference uses, because this is called from a socket handler that
 * cannot await. Default ON: only the explicit string 'false' silences
 * it, exactly like the diagnostics-upload consent it is modelled on.
 */
export function notificationSoundsEnabled(): boolean {
  try {
    return prefs.getSync(PREF_KEYS.notificationSounds) !== 'false';
  } catch {
    return true;
  }
}

/**
 * Play the Bimoto motif. Never throws, never rejects, never blocks.
 *
 * Returns true only when tones were actually scheduled — the unit test
 * reads this; no caller does or should, because a caller that behaved
 * differently when the sound failed would be exactly the bug this
 * module's failure-is-silence rule exists to prevent.
 */
export function playNotificationSound(variant: SoundVariant = 'standard'): boolean {
  try {
    if (!notificationSoundsEnabled()) return false;
    const c = context();
    if (!c) return false;

    // A context suspended in the background (or never unlocked) gets one
    // best-effort nudge. If it does not take, the tones below are
    // scheduled into a suspended context and simply never sound —
    // which is the documented silent failure, not an error.
    if (c.state === 'suspended') void c.resume?.().catch(() => undefined);

    const now = c.currentTime;
    for (const tone of SOUND_PATTERNS[variant]) {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = 'sine';
      osc.frequency.value = tone.freq;

      // An abrupt start or stop on a square-edged gain is a click on a
      // cheap speaker, and a click is what makes a chime sound broken.
      // Ramp both ends.
      const start = now + tone.at;
      const end = start + tone.duration;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(tone.gain, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);

      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(start);
      osc.stop(end + 0.02);
    }
    return true;
  } catch {
    // Failure is silence. The toast has already rendered.
    return false;
  }
}

/** Test seam: drop the cached context so a fresh mock is picked up. */
export function __resetNotificationSoundForTest(): void {
  try {
    void ctx?.close?.();
  } catch {
    // Nothing to do; the reference is dropped either way.
  }
  ctx = null;
}
