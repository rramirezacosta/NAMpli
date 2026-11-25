import { useState } from 'react';
import { useTuner } from '../hooks/useTuner';
import './Tuner.css';

interface TunerProps {
  powered: boolean;
  onBack: () => void;
}

/** Full-window chromatic tuner fed by the backend's YIN pitch detector. */
export default function Tuner({ powered, onBack }: TunerProps) {
  const [referenceHz, setReferenceHz] = useState(440);
  const { hz, levelDb, note, cents, inTune, hasSignal } = useTuner(powered, referenceHz);

  const needle = 50 + cents;
  const inputLevel = Math.max(0, Math.min(100, ((levelDb + 60) / 60) * 100));
  const hasPitch = note !== null && hz > 0;
  const status = !powered
    ? 'Standby'
    : !hasSignal
      ? 'No signal'
      : !hasPitch
        ? 'Finding pitch'
        : inTune
          ? 'In tune'
          : cents < 0
            ? 'Flat'
            : 'Sharp';

  return (
    <div
      className={`tuner view-shell ${powered ? 'active' : ''} ${inTune ? 'in-tune' : ''}`}
      title="Chromatic tuner (detects the pitch of the guitar or bass input)"
    >
      <header className="tuner-header">
        <button type="button" className="tuner-back back-btn" onClick={onBack}>
          ← Back to amp
        </button>
        <h2 className="tuner-title">Tuner</h2>
        <div className="tuner-reference">
          <span>A4</span>
          <button
            type="button"
            onClick={() => setReferenceHz((current) => Math.max(420, current - 1))}
            aria-label="Lower reference pitch"
          >
            −
          </button>
          <span className="tuner-reference-value">{referenceHz} Hz</span>
          <button
            type="button"
            onClick={() => setReferenceHz((current) => Math.min(460, current + 1))}
            aria-label="Raise reference pitch"
          >
            +
          </button>
        </div>
        <span className={`tuner-power ${powered ? 'live' : ''}`}>
          <span className="tuner-power-dot" />
          {powered ? 'Power on' : 'Standby'}
        </span>
      </header>

      <div className="tuner-body">
        <div className="tuner-readout">
          <div className={`tuner-note ${hasPitch ? '' : 'searching'}`}>{note ?? '—'}</div>
          <div className="tuner-cents">
            {hasPitch ? `${cents > 0 ? '+' : ''}${cents} cents` : 'Play a single note'}
          </div>
          <div className="tuner-hz">{hasPitch ? `${hz.toFixed(1)} Hz` : '—'}</div>
        </div>

        <div className="tuner-scale">
          <div className="tuner-scale-labels" aria-hidden="true">
            <span>−50</span>
            <span>−25</span>
            <span>0</span>
            <span>+25</span>
            <span>+50</span>
          </div>
          <div className="tuner-meter">
            <span className="tuner-meter-zone" aria-hidden="true" />
            <span className="tuner-meter-tick tuner-meter-tick-left" aria-hidden="true" />
            <span className="tuner-meter-tick tuner-meter-tick-right" aria-hidden="true" />
            {hasPitch && (
              <span className="tuner-meter-needle" style={{ left: `${needle}%` }} aria-hidden="true" />
            )}
          </div>
          <div className="tuner-scale-legend" aria-hidden="true">
            <span>Flat</span>
            <span>In tune</span>
            <span>Sharp</span>
          </div>
        </div>

        <div className="tuner-input">
          <span className="tuner-input-label">Input</span>
          <div className="tuner-input-bar">
            <span className="tuner-input-fill" style={{ width: `${inputLevel}%` }} />
          </div>
          <span className="tuner-input-db">
            {hasSignal ? `${levelDb.toFixed(1)} dB` : '— dB'}
          </span>
        </div>
      </div>

      <footer className="tuner-footer">
        <span className={`tuner-status ${inTune ? 'in-tune' : ''}`} role="status" aria-live="polite">
          {status}
        </span>
        <span>Raw input — works with the gate closed · Esc to return to the amp</span>
      </footer>
    </div>
  );
}
