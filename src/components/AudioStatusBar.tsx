import type { AudioStatus } from '../tauri';
import './AudioStatusBar.css';

interface AudioStatusBarProps {
  status: AudioStatus | null;
}

/** Small always-visible line with sample rate, latency, xruns, NAM and cab IR. */
export default function AudioStatusBar({ status }: AudioStatusBarProps) {
  if (!status) return null;

  const latencyMs =
    status.sampleRate > 0 ? (status.latencyFrames / status.sampleRate) * 1000 : 0;
  const xrunLabel = `${status.xruns} xrun${status.xruns === 1 ? '' : 's'}`;

  return (
    <div className={`audio-status ${status.powered ? 'live' : ''}`}>
      <span className="audio-status-dot" />
      <span className="audio-status-text">
        {status.powered
          ? `${(status.sampleRate / 1000).toFixed(1)} kHz · ${latencyMs.toFixed(1)} ms · ${xrunLabel}`
          : 'Standby'}
      </span>
      {status.namModel && (
        <span className="audio-status-asset" title={`NAM: ${status.namModel}`}>
          NAM: {status.namModel}
        </span>
      )}
      <span className="audio-status-asset" title={status.irName ?? 'No cabinet IR loaded'}>
        {status.irName ? `Cab: ${status.irName}` : 'No cab IR'}
      </span>
    </div>
  );
}
