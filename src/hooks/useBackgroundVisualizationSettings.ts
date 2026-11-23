import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'nampli.backgroundVisualization';
const DEFAULT_ENABLED = true;
const DEFAULT_INTENSITY = 35;

interface Settings {
  enabled: boolean;
  intensity: number;
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { enabled: DEFAULT_ENABLED, intensity: DEFAULT_INTENSITY };
    const parsed = JSON.parse(raw) as { enabled?: unknown; intensity?: unknown };
    return {
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : DEFAULT_ENABLED,
      intensity:
        typeof parsed.intensity === 'number' && Number.isFinite(parsed.intensity)
          ? Math.max(0, Math.min(100, parsed.intensity))
          : DEFAULT_INTENSITY,
    };
  } catch {
    // Missing or corrupt storage (or a privacy mode that blocks it): use defaults.
    return { enabled: DEFAULT_ENABLED, intensity: DEFAULT_INTENSITY };
  }
}

/** Global UI settings for the ambient background; never part of a preset. */
export function useBackgroundVisualizationSettings() {
  const [settings, setSettings] = useState<Settings>(load);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Persistence is a convenience, not a requirement.
    }
  }, [settings]);

  const setEnabled = useCallback((enabled: boolean) => {
    setSettings((prev) => ({ ...prev, enabled }));
  }, []);

  const setIntensity = useCallback((intensity: number) => {
    const clamped = Math.max(0, Math.min(100, intensity));
    setSettings((prev) => ({ ...prev, intensity: clamped }));
  }, []);

  return { ...settings, setEnabled, setIntensity };
}
