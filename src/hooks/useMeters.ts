import { useEffect, useState } from 'react';
import { getMeters, type MeterSnapshot } from '../tauri';

interface Snapshot {
  /** Which active session produced the reading; guards against stale data. */
  active: boolean;
  meters: MeterSnapshot | null;
}

/**
 * Polls the always-on input/output meter snapshots while the meters are visible.
 * The backend does the RMS/peak work on its DSP worker; this hook only reads a
 * copy at ~30 Hz, so the UI never touches an audio thread.
 */
export function useMeters(active: boolean): MeterSnapshot | null {
  const [snapshot, setSnapshot] = useState<Snapshot>({ active: false, meters: null });

  useEffect(() => {
    if (!active) return;

    let cancelled = false;
    const poll = async () => {
      try {
        const next = await getMeters();
        if (!cancelled) setSnapshot({ active: true, meters: next });
      } catch {
        // The backend may not be ready during a dev reload; try again next tick.
      }
    };

    poll();
    const timer = window.setInterval(poll, 33);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [active]);

  // Never expose a snapshot left over from a previous power cycle / view.
  return snapshot.active === active ? snapshot.meters : null;
}
