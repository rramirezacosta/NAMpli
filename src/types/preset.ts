/** Two banks of four recall slots, like a regular DSP rig footswitch board. */
export type Bank = 'A' | 'B';

export const BANKS: Bank[] = ['A', 'B'];
export const SLOTS = [1, 2, 3, 4];

/** A NAM or IR file stored in the backend's local asset library. */
export interface AssetRef {
  /** Relative id inside app_data/library, e.g. "nams/ab12cd34/JCM800.nam". */
  id: string;
  /** Display name, e.g. "JCM800.nam". */
  name: string;
}

/**
 * Exactly what a preset captures: the six front-panel knobs plus the NAM and IR.
 * Settings-panel values (gate section, cab mix, buffer size) are global.
 */
export interface RigSnapshot {
  inputVolume: number;
  gate: number;
  bass: number;
  middle: number;
  treble: number;
  outputVolume: number;
  model: AssetRef | null;
  ir: AssetRef | null;
}

export interface PresetPayload {
  schemaVersion: number;
  name: string;
  bank: Bank;
  slot: number;
  /** Epoch milliseconds. */
  updatedAt: number;
  rig: RigSnapshot;
}

export interface PresetMeta {
  name: string;
  bank: Bank;
  slot: number;
  modelName: string | null;
  irName: string | null;
  updatedAt: number;
}

export const DEFAULT_RIG: RigSnapshot = {
  inputVolume: 5,
  gate: 0,
  bass: 5,
  middle: 5,
  treble: 5,
  outputVolume: 5,
  model: null,
  ir: null,
};

export function slotLabel(bank: Bank, slot: number): string {
  return `${bank}${slot}`;
}
