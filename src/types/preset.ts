/** Four banks of four recall slots, like a regular DSP rig footswitch board. */
export type Bank = 'A' | 'B' | 'C' | 'D';

export const BANKS: Bank[] = ['A', 'B', 'C', 'D'];
export const SLOTS = [1, 2, 3, 4];

/** A NAM model or a cabinet IR. */
export type AssetKind = 'nam' | 'ir';

/** A NAM or IR file stored in the backend's local asset library. */
export interface AssetRef {
  /** Relative id inside app_data/library, e.g. "nam/ab12cd34/JCM800.nam". */
  id: string;
  /** Display name, e.g. "JCM800.nam". */
  name: string;
}

/** One row in the asset library view. */
export interface AssetMeta extends AssetRef {
  kind: AssetKind;
  size: number;
  /** Epoch milliseconds of the last modification. */
  modified: number;
  /** Preset names whose rig references this asset. */
  usedBy: string[];
}

/**
 * Exactly what a preset captures: the seven front-panel knobs plus the NAM and IR.
 * Audio device and buffer size settings are global.
 */
export interface RigSnapshot {
  inputVolume: number;
  gate: number;
  bass: number;
  middle: number;
  treble: number;
  outputVolume: number;
  reverb: number;
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
  reverb: 0,
  model: null,
  ir: null,
};

export function slotLabel(bank: Bank, slot: number): string {
  return `${bank}${slot}`;
}
