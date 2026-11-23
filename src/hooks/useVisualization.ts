import { useEffect, useState } from 'react';
import {
  getVisualization,
  setVisualizationEnabled,
  type VisualizationFrame,
} from '../tauri';

interface Snapshot {
  /** Which active session produced the frame; guards against stale readings. */
  active: boolean;
  frame: VisualizationFrame | null;
}

/**
 * Polls the backend's visualization snapshot while a consumer wants it and the
 * amp is powered. The same effect drives the enable flag so the DSP worker
 * spends no CPU on the FFT when nothing is displaying it. `App` is the single
 * caller: both the background canvas and the Scope popup share its frame.
 */
export function useVisualization(
  enabled: boolean,
  powered: boolean,
): VisualizationFrame | null {
  const [visible, setVisible] = useState(() => !document.hidden);
  const active = enabled && powered && visible;
  const [snapshot, setSnapshot] = useState<Snapshot>({ active: false, frame: null });

  useEffect(() => {
    const onVisibilityChange = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void setVisualizationEnabled(active).catch(() => {
      // Backend not ready during a dev reload; the next effect will retry.
    });

    if (!active) {
      return () => {
        setSnapshot({ active: false, frame: null });
        void setVisualizationEnabled(false).catch(() => {});
      };
    }

    const poll = async () => {
      try {
        const next = await getVisualization();
        if (!cancelled) setSnapshot({ active: true, frame: next });
      } catch {
        // Backend not ready; keep the last frame rather than flashing.
      }
    };

    poll();
    const timer = window.setInterval(poll, 33);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      setSnapshot({ active: false, frame: null });
      void setVisualizationEnabled(false).catch(() => {});
    };
  }, [active]);

  // Never expose a frame left over from a previous session.
  return snapshot.active === active ? snapshot.frame : null;
}
