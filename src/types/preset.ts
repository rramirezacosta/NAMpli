/** A slot that currently holds a preset: its id plus the user-facing label. */
export interface PresetSlotInfo {
  slot: string;
  name: string;
  /** NAM model name stored in the preset (optional). */
  modelName?: string | null;
  /** IR name stored in the preset (optional). */
  irName?: string | null;
}

/** Imperative bridge so the main-panel preset carousel can drive the settings panel. */
export interface PresetBarActions {
  /** Occupied slots in display order. */
  slots: PresetSlotInfo[];
  currentSlot: string | null;
  isDirty: boolean;
  modelName: string | null;
  irName: string | null;
  loadSlot: (slot: string) => void;
  /** Whether the current state is an "unnamed" preset (loaded from a dropped file, not saved to a slot). */
  isUnnamed: boolean;
  /** Display name of the NAM model loaded in unnamed mode. */
  unnamedModelName: string | null;
  /** Display name of the IR loaded in unnamed mode. */
  unnamedIrName: string | null;
  /** Opens the preset library so the user can save the unnamed preset to a slot. */
  saveUnnamed: () => void;
}
