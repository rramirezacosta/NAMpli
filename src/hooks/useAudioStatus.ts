import { useEffect, useRef, useState } from 'react';
import { getAudioStatus, type AudioStatus } from '../tauri';
import { notifyError } from '../notifications';

/**
 * Polls the audio engine once a second for status and stream errors.
 *
 * cpal reports buffer underruns from the audio thread, where the UI cannot see
 * them. The backend stores the last error plus a counter, and this hook turns a
 * new error (or a rising xrun count) into a visible toast.
 */
export function useAudioStatus(): AudioStatus | null {
  const [status, setStatus] = useState<AudioStatus | null>(null);
  const lastError = useRef<string | null>(null);
  const lastXruns = useRef(0);
  const xrunNotified = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const next = await getAudioStatus();
        if (cancelled) return;
        setStatus(next);

        if (next.lastError && next.lastError !== lastError.current) {
          notifyError(`Audio device error: ${next.lastError}`);
        }

        if (next.xruns > lastXruns.current) {
          if (!xrunNotified.current) {
            notifyError(
              'Audio buffer underrun detected. Raise Latency in Settings if it keeps happening.',
            );
            xrunNotified.current = true;
          }
        } else if (next.xruns === 0) {
          // A stream restart resets the counter; allow another warning.
          xrunNotified.current = false;
        }

        lastError.current = next.lastError;
        lastXruns.current = next.xruns;
      } catch {
        // The backend is not ready during a dev reload; try again next tick.
      }
    };

    poll();
    const timer = window.setInterval(poll, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return status;
}
