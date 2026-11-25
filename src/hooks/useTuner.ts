import { useEffect, useRef, useState } from 'react';
import { getTuner } from '../tauri';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const POLL_MS = 60;
/** Below this input level there is nothing useful to tune. */
const NO_SIGNAL_DB = -70;
/** Keep the last note briefly through short dropouts between plucks. */
const HOLD_MS = 300;

export interface TunerSnapshot {
  /** Detected pitch, or 0 when no stable pitch is present. */
  hz: number;
  /** Raw input level in dBFS, independent of trim, gate and NAM. */
  levelDb: number;
  note: string | null;
  /** Smoothed deviation from the nearest semitone, -50..+50. */
  cents: number;
  inTune: boolean;
  /** True while the input is loud enough to tune. */
  hasSignal: boolean;
}

const IDLE: TunerSnapshot = {
  hz: 0,
  levelDb: -120,
  note: null,
  cents: 0,
  inTune: false,
  hasSignal: false,
};

function noteFromHz(hz: number, referenceHz: number) {
  // MIDI 69 = A4 = referenceHz (440 by default).
  const midi = 69 + 12 * Math.log2(hz / referenceHz);
  const rounded = Math.round(midi);
  const cents = Math.round((midi - rounded) * 100);
  const name = `${NOTE_NAMES[((rounded % 12) + 12) % 12]}${Math.floor(rounded / 12) - 1}`;
  return { name, cents };
}

/**
 * Poll the backend tuner once per tick and turn its raw reading into a stable
 * display snapshot. The backend analyzes roughly every 120 ms, so polling at
 * 60 ms sees each fresh result without aliasing. A note must be seen twice
 * before it replaces the displayed one, and the last note is held for a short
 * grace period after the string stops.
 */
export function useTuner(enabled: boolean, referenceHz: number): TunerSnapshot {
  const [snapshot, setSnapshot] = useState<TunerSnapshot>(IDLE);
  const lastNote = useRef<string | null>(null);
  const candidate = useRef<{ name: string; count: number } | null>(null);
  const lastPitchAt = useRef(0);
  const smoothedCents = useRef(0);

  useEffect(() => {
    if (!enabled) {
      lastNote.current = null;
      candidate.current = null;
      smoothedCents.current = 0;
      return;
    }

    let cancelled = false;
    const poll = async () => {
      if (document.hidden) return;

      let reading;
      try {
        reading = await getTuner();
      } catch {
        // Backend not ready; keep the last reading rather than flashing.
        return;
      }
      if (cancelled) return;

      const now = Date.now();
      const hasSignal = reading.levelDb > NO_SIGNAL_DB;
      if (reading.hz <= 0 || !hasSignal) {
        // Keep the last note briefly so a gap between plucks is not a flicker,
        // but let the input level fall immediately.
        setSnapshot((prev) => ({
          ...prev,
          hz: reading.hz,
          levelDb: reading.levelDb,
          hasSignal,
          inTune: false,
        }));
        if (now - lastPitchAt.current > HOLD_MS) {
          lastNote.current = null;
          candidate.current = null;
          smoothedCents.current = 0;
          setSnapshot({ ...IDLE, levelDb: reading.levelDb });
        }
        return;
      }

      const detected = noteFromHz(reading.hz, referenceHz);
      const previous = candidate.current;
      candidate.current =
        previous?.name === detected.name
          ? { name: detected.name, count: previous.count + 1 }
          : { name: detected.name, count: 1 };

      let name = lastNote.current;
      if (name === null || (name !== detected.name && candidate.current.count >= 2)) {
        name = detected.name;
        lastNote.current = name;
        smoothedCents.current = detected.cents;
      }
      lastPitchAt.current = now;
      smoothedCents.current = smoothedCents.current * 0.6 + detected.cents * 0.4;
      const cents = Math.max(-50, Math.min(50, Math.round(smoothedCents.current)));

      setSnapshot({
        hz: reading.hz,
        levelDb: reading.levelDb,
        note: name,
        cents,
        inTune: name !== null && Math.abs(cents) <= 5,
        hasSignal: true,
      });
    };

    void poll();
    const timer = window.setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [enabled, referenceHz]);

  return enabled ? snapshot : IDLE;
}
