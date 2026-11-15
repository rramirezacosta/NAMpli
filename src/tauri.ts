import { invoke } from '@tauri-apps/api/core';

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

export async function setGainLevel(level: number): Promise<void> {
  return invoke('set_gain_level', { level });
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

export async function setSensitivity(sensitivity: 'high' | 'low'): Promise<void> {
  return invoke('set_sensitivity', { sensitivity });
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
