import { useEffect, useRef } from 'react';
import type { VisualizationFrame } from '../tauri';
import './BackgroundVisualization.css';

interface BackgroundVisualizationProps {
  frame: VisualizationFrame | null;
  /** 0..100, from Settings. Multiplies the opacity, never the data. */
  intensity: number;
}

interface Surface {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
}

function prepare(canvas: HTMLCanvasElement): Surface | null {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  // Cap DPR: a full-window canvas at 3x would cost far more than the data is worth.
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const pixelWidth = Math.round(width * dpr);
  const pixelHeight = Math.round(height * dpr);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width, height };
}

// Gradients are tied to a canvas context and only depend on its height.
const gradients = new WeakMap<HTMLCanvasElement, { height: number; gradient: CanvasGradient }>();

function spectrumGradient(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  height: number,
  barMax: number,
): CanvasGradient {
  const cached = gradients.get(canvas);
  if (cached && cached.height === height) return cached.gradient;
  const gradient = ctx.createLinearGradient(0, height, 0, height - barMax);
  gradient.addColorStop(0, 'rgba(212, 175, 55, 0.95)');
  gradient.addColorStop(0.3, 'rgba(180, 120, 40, 0.55)');
  gradient.addColorStop(1, 'rgba(150, 95, 35, 0)');
  gradients.set(canvas, { height, gradient });
  return gradient;
}

function draw(canvas: HTMLCanvasElement, frame: VisualizationFrame | null, intensity: number): void {
  const surface = prepare(canvas);
  if (!surface) return;
  const { ctx, width, height } = surface;
  ctx.clearRect(0, 0, width, height);

  const alpha = Math.max(0, Math.min(1, intensity / 100));
  if (alpha === 0 || !frame) return;

  const spectrum = frame.spectrum;
  if (spectrum.length > 0) {
    const barMax = height * 0.34;
    const barWidth = width / spectrum.length;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = spectrumGradient(ctx, canvas, height, barMax);
    for (let i = 0; i < spectrum.length; i++) {
      const value = Math.max(0, Math.min(1, spectrum[i]));
      const barHeight = value * barMax;
      if (barHeight < 0.5) continue;
      ctx.fillRect(i * barWidth, height - barHeight, Math.max(1, barWidth + 0.5), barHeight);
    }
    ctx.globalAlpha = 1;
  }

  const waveform = frame.waveform;
  if (waveform.length > 0) {
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
      const y = height / 2 - sample * height * 0.16;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = `rgba(240, 208, 96, ${(0.18 * alpha).toFixed(3)})`;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

/** Ambient waveform/spectrum behind the faceplate. Purely decorative. */
export default function BackgroundVisualization({
  frame,
  intensity,
}: BackgroundVisualizationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastIntensityRef = useRef<number | null>(null);

  useEffect(() => {
    // Reduced-motion users get one static frame; intensity changes still redraw.
    const reduceMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion && lastIntensityRef.current === intensity) return;

    const animation = requestAnimationFrame(() => {
      if (canvasRef.current) {
        draw(canvasRef.current, frame, intensity);
        lastIntensityRef.current = intensity;
      }
    });
    return () => cancelAnimationFrame(animation);
  }, [frame, intensity]);

  return (
    <div className="background-visualization" aria-hidden="true">
      <canvas ref={canvasRef} className="background-visualization-canvas" />
      <div className="background-visualization-vignette" />
    </div>
  );
}
