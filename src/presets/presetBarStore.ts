import type { PresetBarActions } from '../types/preset';

// Tiny external store shared between the always-mounted SettingsPanel (which
// owns the preset logic) and the main-panel preset carousel. Avoids passing
// refs through render, which React explicitly discourages.
let state: PresetBarActions | null = null;
const listeners = new Set<() => void>();

export function setPresetBarActions(next: PresetBarActions): void {
  state = next;
  listeners.forEach((listener) => listener());
}

export function clearPresetBarActions(): void {
  state = null;
  listeners.forEach((listener) => listener());
}

export function subscribePresetBar(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getPresetBarSnapshot(): PresetBarActions | null {
  return state;
}
