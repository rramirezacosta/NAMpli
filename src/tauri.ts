import { invoke } from '@tauri-apps/api/core';
import type {
  AssetKind,
  AssetMeta,
  AssetRef,
  PresetMeta,
  PresetPayload,
  RigSnapshot,
} from './types/preset';

export interface AudioDeviceInfo {
  id: string;
  label: string;
  isDefault: boolean;
}

export interface AudioDevices {
  inputs: AudioDeviceInfo[];
  outputs: AudioDeviceInfo[];
  defaultInput: string | null;
  defaultOutput: string | null;
}

export async function startAudio(
  inputDevice?: string,
  outputDevice?: string,
): Promise<void> {
  return invoke('start_audio', { inputDevice, outputDevice });
}

export async function stopAudio(): Promise<void> {
  return invoke('stop_audio');
}

export async function setAudioDevices(
  inputDevice?: string,
  outputDevice?: string,
): Promise<void> {
  return invoke('set_audio_devices', { inputDevice, outputDevice });
}

export async function setBass(value: number): Promise<void> {
  return invoke('set_bass', { value });
}

export async function setMiddle(value: number): Promise<void> {
  return invoke('set_middle', { value });
}

export async function setTreble(value: number): Promise<void> {
  return invoke('set_treble', { value });
}

export async function setMasterVolume(value: number): Promise<void> {
  return invoke('set_master_volume', { value });
}

export async function setPresence(value: number): Promise<void> {
  return invoke('set_presence', { value });
}

export async function setPreamp(value: number): Promise<void> {
  return invoke('set_preamp', { value });
}

export async function setReverb(value: number): Promise<void> {
  return invoke('set_reverb', { value });
}

export async function setNoiseGate(
  enabled: boolean,
  thresholdDb: number,
  decayMs: number,
): Promise<void> {
  return invoke('set_noise_gate', { enabled, thresholdDb, decayMs });
}

export async function loadIr(path: string): Promise<string> {
  return invoke('load_ir', { path });
}

export async function clearIr(): Promise<void> {
  return invoke('clear_ir');
}

export async function clearNam(): Promise<void> {
  return invoke('clear_nam');
}

export async function setIrMix(value: number): Promise<void> {
  return invoke('set_ir_mix', { value });
}

export interface AudioStatus {
  powered: boolean;
  sampleRate: number;
  latencyFrames: number;
  xruns: number;
  lastError: string | null;
  irName: string | null;
  namModel: string | null;
}

export async function getAudioStatus(): Promise<AudioStatus> {
  return invoke('get_audio_status');
}

export interface TunerStatus {
  hz: number;
  levelDb: number;
}

export async function getTuner(): Promise<TunerStatus> {
  return invoke('get_tuner');
}

export interface MeterReading {
  /** Rolling RMS over ~100 ms, dBFS. */
  levelDb: number;
  /** Rolling peak over ~100 ms, dBFS. */
  peakDb: number;
  /** Decaying peak-hold marker, dBFS. */
  peakHoldDb: number;
  /** Latched briefly after a clipped sample. */
  clipped: boolean;
}

export interface MeterSnapshot {
  input: MeterReading;
  output: MeterReading;
}

export async function getMeters(): Promise<MeterSnapshot> {
  return invoke('get_meters');
}

export async function togglePower(): Promise<boolean> {
  return invoke('toggle_power');
}

export async function setBufferSize(size: number): Promise<void> {
  return invoke('set_buffer_size', { size });
}

export async function listAudioHosts(): Promise<string[]> {
  return invoke('list_audio_hosts');
}

export async function listAudioDevices(host?: string): Promise<AudioDevices> {
  return invoke('list_audio_devices', { host });
}

export async function setAudioHost(host?: string): Promise<void> {
  return invoke('set_audio_host', { host });
}

export async function loadNamFromBytes(filename: string, data: string): Promise<string> {
  return invoke('load_nam_from_bytes', { filename, data });
}

export async function loadNamFromPath(path: string): Promise<string> {
  return invoke('load_nam_from_path', { path });
}

export async function saveIrFile(filename: string, data: string): Promise<string> {
  return invoke('save_ir_file', { filename, data });
}

// --- Presets -------------------------------------------------------------

export async function listPresets(): Promise<PresetMeta[]> {
  return invoke('list_presets');
}

export async function savePreset(preset: PresetPayload): Promise<void> {
  return invoke('save_preset', { preset });
}

/** Loads the NAM/IR in the backend and returns the payload for UI sync. */
export async function loadPreset(name: string): Promise<PresetPayload> {
  return invoke('load_preset', { name });
}

/** Restore an arbitrary rig's NAM/IR from the local asset library (audition revert). */
export async function loadRigAssets(rig: RigSnapshot): Promise<void> {
  return invoke('load_rig_assets', { rig });
}

// --- Asset library --------------------------------------------------------

/** All stored NAM/IR files with metadata and the presets that reference them. */
export async function listAssets(): Promise<AssetMeta[]> {
  return invoke('list_assets');
}

/** Store a copy without changing the live sound (Library import). */
export async function storeAsset(
  kind: AssetKind,
  filename: string,
  path?: string,
  data?: string,
): Promise<AssetRef> {
  return invoke('store_asset_file', {
    kind,
    filename,
    path: path ?? null,
    data: data ?? null,
  });
}

/** Load a stored NAM/IR into the engine. */
export async function loadAsset(id: string): Promise<AssetRef> {
  return invoke('load_asset', { id });
}

/** Copy a stored asset to a user-chosen path. */
export async function exportAssetToPath(id: string, path: string): Promise<void> {
  return invoke('export_asset_to_path', { id, path });
}

/** Delete a stored asset; returns the preset names affected by a forced delete. */
export async function deleteAsset(id: string, force = false): Promise<string[]> {
  return invoke('delete_asset', { id, force });
}

export interface RenameAssetResult {
  asset: AssetRef;
  /** Presets whose references were updated to the new id. */
  affected: string[];
}

/** Rename a stored asset and update every preset that referenced it. */
export async function renameAsset(id: string, newName: string): Promise<RenameAssetResult> {
  return invoke('rename_asset', { id, newName });
}

/** Remove assets that no preset uses; `keep` holds ids loaded in the live rig. */
export async function cleanLibrary(keep: string[]): Promise<string[]> {
  return invoke('clean_library', { keep });
}

/** Read-only preset payload (no engine side effects). */
export async function getPreset(name: string): Promise<PresetPayload> {
  return invoke('get_preset', { name });
}

/** Assets already stored in the local library, for preset-editor pickers. */
export async function listLibraryAssets(kind: 'nam' | 'ir'): Promise<AssetRef[]> {
  return invoke('list_library_assets', { kind });
}

/** Relocate a preset to another bank/slot, replacing the occupant if allowed. */
export async function movePreset(
  name: string,
  bank: string,
  slot: number,
  replace: boolean,
): Promise<void> {
  return invoke('move_preset', { name, bank, slot, replace });
}

export async function deletePreset(name: string): Promise<void> {
  return invoke('delete_preset', { name });
}

export async function renamePreset(name: string, newName: string): Promise<void> {
  return invoke('rename_preset', { name, newName });
}

export async function exportPreset(name: string): Promise<string> {
  return invoke('export_preset', { name });
}

export async function exportPresetToPath(name: string, path: string): Promise<void> {
  return invoke('export_preset_to_path', { name, path });
}

export async function importPreset(json: string): Promise<PresetMeta> {
  return invoke('import_preset', { json });
}

export async function importPresetFromPath(path: string): Promise<PresetMeta> {
  return invoke('import_preset_from_path', { path });
}

/** Store a copy of a dropped NAM/IR in the library and load it into the engine. */
export async function importAsset(
  kind: 'nam' | 'ir',
  filename: string,
  path?: string,
  data?: string,
): Promise<AssetRef> {
  return invoke('import_asset', { kind, filename, path: path ?? null, data: data ?? null });
}

export async function logToTerminal(msg: string): Promise<void> {
  return invoke('log_to_terminal', { msg });
}
