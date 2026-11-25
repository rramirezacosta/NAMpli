import type { MeterReading } from '../tauri';
import './LevelMeter.css';

interface LevelMeterProps {
  label: string;
  reading: MeterReading | null;
  active: boolean;
}

const MIN_DB = -60;
const SPLIT_DB = -20;
const TICKS = [0, -10, SPLIT_DB, -30, -40, -50, MIN_DB];

/**
 * Log-style dB scale: the 0..-20 dB decade uses the upper half of the track and
 * the -20..-60 dB range the lower half. Both halves are linear in dB (i.e.
 * logarithmic in amplitude), so -20 dB sits exactly at the midpoint while
 * quiet signals still have usable space.
 */
function fraction(db: number): number {
  if (!Number.isFinite(db)) return 0;
  const level = Math.min(0, Math.max(MIN_DB, db));
  if (level >= SPLIT_DB) {
    return 0.5 + ((level - SPLIT_DB) / -SPLIT_DB) * 0.5;
  }
  return ((level - MIN_DB) / (SPLIT_DB - MIN_DB)) * 0.5;
}

/** Read-only vertical dB meter with a peak-hold marker and clip indicator. */
export default function LevelMeter({ label, reading, active }: LevelMeterProps) {
  const level = reading ? fraction(reading.levelDb) : 0;
  const hold = reading ? Math.min(98, fraction(reading.peakHoldDb) * 100) : 0;
  const clipped = active && (reading?.clipped ?? false);

  return (
    <div
      className={`level-meter ${active && reading ? 'active' : ''} ${clipped ? 'clipped' : ''}`}
      role="meter"
      aria-label={`${label} level`}
      aria-valuemin={MIN_DB}
      aria-valuemax={0}
      aria-valuenow={reading ? Math.round(reading.levelDb) : MIN_DB}
      aria-valuetext={
        reading
          ? `${reading.levelDb.toFixed(1)} dB, peak ${reading.peakDb.toFixed(1)} dB${clipped ? ', clipping' : ''}`
          : `${label} idle`
      }
    >
      <span className="level-meter-label">{label}</span>
      <div className="level-meter-body">
        <div className="level-meter-scale" aria-hidden="true">
          {TICKS.map((tick) => (
            <span
              className="level-meter-tick"
              key={tick}
              style={{ bottom: `${fraction(tick) * 100}%` }}
            >
              <i className="level-meter-tick-mark" />
              <span className="level-meter-tick-label">{tick}</span>
            </span>
          ))}
        </div>
        <div className="level-meter-track" aria-hidden="true">
          {/* clip-path keeps the green/gold/red zones anchored to the scale. */}
          <div
            className="level-meter-fill"
            style={{ clipPath: `inset(${(1 - level) * 100}% 0 0 0)` }}
          />
          <div className="level-meter-hold" style={{ bottom: `${hold}%` }} />
        </div>
        <span className="level-meter-clip" title="Peak clip" aria-hidden="true" />
      </div>
    </div>
  );
}
