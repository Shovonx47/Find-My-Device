/**
 * Web Audio API Sound Generator for Ring Alarms and Message Notifications.
 * Respects browser autoplay restrictions and manages audio context unlocking.
 */

let sharedAudioCtx: AudioContext | null = null;
let currentRingStopFn: (() => void) | null = null;

export function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;

  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

    if (!AudioContextClass) return null;

    if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
      sharedAudioCtx = new AudioContextClass();
    }
    return sharedAudioCtx;
  } catch {
    return null;
  }
}

/**
 * Checks if the Web Audio context is active and allowed to produce sound.
 */
export function isAudioUnlocked(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const ctx = getAudioContext();
    return Boolean(ctx && ctx.state === 'running');
  } catch {
    return false;
  }
}

/**
 * Attempts to resume/unlock the audio context following user interaction.
 */
export async function unlockAudio(): Promise<boolean> {
  if (typeof window === 'undefined') return false;

  try {
    const ctx = getAudioContext();
    if (!ctx) return false;

    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    const running = ctx.state === 'running';
    if (running && typeof window !== 'undefined' && window.sessionStorage) {
      try {
        window.sessionStorage.setItem('fmd_sound_enabled', '1');
      } catch {
        // Ignore session storage errors
      }
    }
    return running;
  } catch {
    return false;
  }
}

// Auto-register user gesture listeners on window once loaded in browser
if (typeof window !== 'undefined') {
  const handleFirstInteraction = () => {
    void unlockAudio();
    window.removeEventListener('click', handleFirstInteraction);
    window.removeEventListener('keydown', handleFirstInteraction);
    window.removeEventListener('touchstart', handleFirstInteraction);
  };

  window.addEventListener('click', handleFirstInteraction, { passive: true });
  window.addEventListener('keydown', handleFirstInteraction, { passive: true });
  window.addEventListener('touchstart', handleFirstInteraction, { passive: true });
}

/**
 * Stops any currently playing ring tone immediately.
 */
export function stopRingTone(): void {
  if (currentRingStopFn) {
    try {
      currentRingStopFn();
    } catch {
      // Ignore cleanup error
    }
    currentRingStopFn = null;
  }
}

/**
 * Plays a loud, attention-grabbing alert tone (2-3 seconds) for incoming Ring commands.
 * Pattern: Two bursts of dual-frequency telephone ring chirps (853Hz + 960Hz) with master gain ~0.65.
 */
export function playRingTone(): void {
  if (typeof window === 'undefined') return;

  try {
    stopRingTone();

    const ctx = getAudioContext();
    if (!ctx) return;

    if (ctx.state === 'suspended') {
      void ctx.resume();
    }

    const now = ctx.currentTime;
    const activeNodes: { stop?: () => void; disconnect?: () => void }[] = [];

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.65, now);
    masterGain.connect(ctx.destination);
    activeNodes.push(masterGain);

    // Two ring bursts: 0.0s -> 0.9s and 1.2s -> 2.1s, total duration ~2.4s
    const bursts = [
      { start: now + 0.0, end: now + 0.9 },
      { start: now + 1.2, end: now + 2.1 },
    ];

    bursts.forEach(({ start, end }) => {
      // Each burst consists of 3 pulsing chirps
      const chirps = [
        { t0: start + 0.00, t1: start + 0.24 },
        { t0: start + 0.30, t1: start + 0.54 },
        { t0: start + 0.60, t1: end },
      ];

      chirps.forEach(({ t0, t1 }) => {
        // Dual tones (853Hz & 960Hz) produce standard telephone ring acoustic beating
        [853, 960].forEach((freq) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();

          osc.type = 'triangle'; // Richer harmonics than pure sine for audible punch
          osc.frequency.setValueAtTime(freq, t0);

          // Envelope: sharp attack, sustained body, quick decay
          gain.gain.setValueAtTime(0, t0);
          gain.gain.linearRampToValueAtTime(0.35, t0 + 0.02);
          gain.gain.setValueAtTime(0.35, t1 - 0.03);
          gain.gain.exponentialRampToValueAtTime(0.001, t1);

          osc.connect(gain);
          gain.connect(masterGain);

          osc.start(t0);
          osc.stop(t1);

          activeNodes.push(osc, gain);
        });
      });
    });

    currentRingStopFn = () => {
      try {
        masterGain.gain.cancelScheduledValues(ctx.currentTime);
        masterGain.gain.setValueAtTime(0, ctx.currentTime);
        activeNodes.forEach((node) => {
          if (node.stop) node.stop();
          if (node.disconnect) node.disconnect();
        });
      } catch {
        // Ignore errors on stopping
      }
    };

    // Auto-clear stop fn when sound completes (~2.4s)
    setTimeout(() => {
      if (currentRingStopFn) {
        currentRingStopFn = null;
      }
    }, 2500);
  } catch {
    // Graceful fallback if audio is disallowed or blocked by policy
  }
}

/**
 * Plays a short, quieter "message tick" sound (single notification chime) for incoming messages.
 * Distinct from the ring sound: two gentle ascending notes (587Hz -> 880Hz), duration ~180ms, gain ~0.2.
 */
export function playMessageTickSound(): void {
  if (typeof window === 'undefined') return;

  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    if (ctx.state === 'suspended') {
      void ctx.resume();
    }

    const now = ctx.currentTime;
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.2, now);
    masterGain.connect(ctx.destination);

    // Two soft ascending pings: D5 (587.33Hz) -> A5 (880Hz)
    const notes = [
      { freq: 587.33, start: now + 0.00, dur: 0.07 },
      { freq: 880.00, start: now + 0.06, dur: 0.11 },
    ];

    notes.forEach(({ freq, start, dur }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.35, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, start + dur);

      osc.connect(gain);
      gain.connect(masterGain);

      osc.start(start);
      osc.stop(start + dur + 0.02);
    });
  } catch {
    // Non-blocking fallback
  }
}

/**
 * Alias for backward compatibility.
 */
export function playChimeSound(): void {
  playMessageTickSound();
}

