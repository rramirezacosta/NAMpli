import { useEffect, useState } from 'react';
import { getTuner } from '../tauri';
import './Tuner.css';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

interface DetectedNote {
  name: string;
  cents: number;
}

function noteFromHz(hz: number): DetectedNote {
  // MIDI 69 = A4 = 440Hz.
  const midi = 69 + 12 * Math.log2(hz / 440);
  const rounded = Math.round(midi);
  const cents = Math.round((midi - rounded) * 100);
  const name = `${NOTE_NAMES[((rounded % 12) + 12) % 12]}${Math.floor(rounded / 12) - 1}`;
  return { name, cents };
}

interface TunerProps {
  powered: boolean;
}

/** Chromatic tuner fed by the backend's YIN pitch detector. */
export default function Tuner({ powered }: TunerProps) {
  const [hz, setHz] = useState(0);

  useEffect(() => {
    if (!powered) return;

    let cancelled = false;
    const poll = async () => {
      try {
        const reading = await getTuner();
        if (!cancelled) setHz(reading.hz);
      } catch {
        // Backend not ready; keep the last reading rather than flashing.
      }
    };

    poll();
    const timer = window.setInterval(poll, 120);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [powered]);

  const displayHz = powered ? hz : 0;
  const note = displayHz > 0 ? noteFromHz(displayHz) : null;
  const inTune = note !== null && Math.abs(note.cents) <= 5;
  const needle = note ? 50 + Math.max(-50, Math.min(50, note.cents)) : 50;

  return (
    <div
      className={`tuner ${powered ? 'active' : ''} ${inTune ? 'in-tune' : ''}`}
      title="Chromatic tuner (detects the pitch of the guitar or bass input)"
    >
      <div className="tuner-header">
        <span className="tuner-label">Tuner</span>
        <span className="tuner-hz">{displayHz > 0 ? `${displayHz.toFixed(1)} Hz` : '—'}</span>
      </div>
      <div className="tuner-reading">
        <span className="tuner-note">{note ? note.name : '—'}</span>
        <span className="tuner-cents">
          {note ? `${note.cents > 0 ? '+' : ''}${note.cents}¢` : ''}
        </span>
      </div>
      <div className="tuner-meter">
        <span className="tuner-meter-tick tuner-meter-tick-left" />
        <span className="tuner-meter-tick tuner-meter-tick-right" />
        <span className="tuner-meter-center" />
        {note && <span className="tuner-meter-needle" style={{ left: `${needle}%` }} />}
      </div>
    </div>
  );
}
