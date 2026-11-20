import { useEffect, useState } from 'react';
import { getWindowControlsInfo, type WindowControlsSide } from '../tauri';

/**
 * Reads the OS/desktop preference for which side of the title bar hosts the
 * window controls (GNOME's `button-layout`, XFCE's `button_layout`, ...).
 *
 * Starts at "right" and keeps that default when detection is unavailable,
 * e.g. in a plain browser where Tauri `invoke` does not exist.
 */
export function useWindowControlsSide(): WindowControlsSide {
  const [side, setSide] = useState<WindowControlsSide>('right');

  useEffect(() => {
    let cancelled = false;

    void getWindowControlsInfo()
      .then((info) => {
        if (!cancelled) setSide(info.side);
      })
      .catch(() => {
        // No desktop setting available — keep the right-side default.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return side;
}
