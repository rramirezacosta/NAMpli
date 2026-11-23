import { useEffect, useRef } from 'react';
import type { VisualizationFrame } from '../tauri';
import './Visualization.css';

interface VisualizationProps {
  /** Shared snapshot from the single hook in App. */
  frame: VisualizationFrame | null;
  powered: boolean;
}

const MIN_HZ = 60;
const MAX_HZ = 16000;
const BANDS = 64;
const FREQ_LABELS = [100, 1000, 10000];

/** Mirrors `bin_ranges` in visualizer.rs so the axis lines up with the bars. */
function bandForHz(hz: number): number {
  const band = (BANDS * Math.log(hz / MIN_HZ)) / Math.log(MAX_HZ / MIN_HZ) - 0.5;
  return Math.max(0, Math.min(BANDS - 1, band));
}

interface Surface {
  ctx: CanvasRenderingContext2D | null;
  width: number;
  height: number;
}

function surface(canvas: HTMLCanvasElement): Surface | null {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  const dpr = window.devicePixelRatio || 1;
  const pixelWidth = Math.round(width * dpr);
  const pixelHeight = Math.round(height * dpr);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const ctx = canvas.getContext('2d');
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width, height };
}

function drawWaveform(canvas: HTMLCanvasElement, waveform?: number[]): void {
  const surfaceRef = surface(canvas);
  if (!surfaceRef) return;
  const { ctx, width, height } = surfaceRef;
  if (!ctx) return;

  ctx.fillStyle = '#0d0d0d';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = 'rgba(212, 175, 55, 0.09)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const x = (width * i) / 4;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
    const y = (height * i) / 4;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(212, 175, 55, 0.28)';
  ctx.beginPath();
  ctx.moveTo(0, height / 2);
  ctx.lineTo(width, height / 2);
  ctx.stroke();

  if (!waveform || waveform.length === 0) {
    ctx.strokeStyle = 'rgba(168, 155, 128, 0.3)';
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();
    return;
  }

  // Lock onto a rising zero crossing near the middle so notes stay centred.
  const count = waveform.length;
  const middle = Math.floor(count / 2);
  const span = 128;
  let start = 0;
  for (let i = Math.max(1, middle - span); i < Math.min(count, middle + span); i++) {
    if (waveform[i - 1] <= 0 && waveform[i] > 0) {
      start = i;
      break;
    }
  }

  const step = Math.max(1, Math.floor(count / Math.floor(width)));
  ctx.beginPath();
  for (let i = 0; i < count; i += step) {
    const sample = waveform[(start + i) % count];
    const x = (i / count) * width;
    const y = height / 2 - sample * (height / 2 - 3);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = '#f0d060';
  ctx.lineWidth = 1.3;
  ctx.shadowColor = 'rgba(240, 208, 96, 0.45)';
  ctx.shadowBlur = 4;
  ctx.stroke();
  ctx.shadowBlur = 0;
}

function drawSpectrum(canvas: HTMLCanvasElement, spectrum?: number[]): void {
  const surfaceRef = surface(canvas);
  if (!surfaceRef) return;
  const { ctx, width, height } = surfaceRef;
  if (!ctx) return;

  ctx.fillStyle = '#0d0d0d';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(168, 155, 128, 0.7)';
  ctx.font = '9px sans-serif';
  ctx.textBaseline = 'top';
  for (const hz of FREQ_LABELS) {
    const x = (bandForHz(hz) / BANDS) * width;
    ctx.strokeStyle = 'rgba(212, 175, 55, 0.1)';
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height - 11);
    ctx.stroke();
    const label = hz >= 1000 ? `${hz / 1000}k` : String(hz);
    const textWidth = ctx.measureText(label).width;
    ctx.fillText(label, Math.min(width - textWidth, Math.max(0, x - textWidth / 2)), height - 10);
  }

  if (!spectrum || spectrum.length === 0) return;
  const chartHeight = height - 11;
  const gradient = ctx.createLinearGradient(0, chartHeight, 0, 0);
  gradient.addColorStop(0, 'rgba(150, 95, 35, 0.9)');
  gradient.addColorStop(1, '#f0d060');
  ctx.fillStyle = gradient;
  const barWidth = width / spectrum.length;
  for (let i = 0; i < spectrum.length; i++) {
    const value = Math.max(0, Math.min(1, spectrum[i]));
    const barHeight = value * (chartHeight - 1);
    if (barHeight < 0.5) continue;
    ctx.fillRect(i * barWidth, chartHeight - barHeight, Math.max(1, barWidth - 0.5), barHeight);
  }
}

/** Read-only waveform / spectrum / level display fed by the audio engine. */
export default function Visualization({ frame, powered }: VisualizationProps) {
  const waveformRef = useRef<HTMLCanvasElement>(null);
  const spectrumRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (waveformRef.current) drawWaveform(waveformRef.current, frame?.waveform);
    if (spectrumRef.current) drawSpectrum(spectrumRef.current, frame?.spectrum);
  }, [frame]);

  const level = frame ? Math.max(0, Math.min(1, (frame.levelDb + 60) / 60)) : 0;
  const clipping = frame !== null && frame.peakDb > -0.5;

  return (
    <div className={`visualization ${frame ? 'active' : ''}`}>
      <div className="visualization-header">
        <span className="visualization-label">Scope</span>
        <span className="visualization-readout">
          {frame ? `${frame.levelDb.toFixed(1)} dB` : '—'}
        </span>
      </div>

      <div className="visualization-section">
        <span className="visualization-section-label">Waveform</span>
        <canvas ref={waveformRef} className="visualization-canvas visualization-wave" />
      </div>

      <div className="visualization-section">
        <span className="visualization-section-label">Spectrum</span>
        <canvas ref={spectrumRef} className="visualization-canvas visualization-spectrum" />
      </div>

      <div className="visualization-level-row">
        <span className="visualization-section-label">Level</span>
        <div className="visualization-level">
          <span
            className="visualization-level-fill"
            style={{ width: `${level * 100}%` }}
          />
        </div>
        <span className={`visualization-clip ${clipping ? 'clipping' : ''}`} title="Peak clip">
          CLIP
        </span>
      </div>

      {!powered && <p className="visualization-hint">Power on to see the signal</p>}
    </div>
  );
}
