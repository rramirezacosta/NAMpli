import { useCallback, useState } from 'react';
import type { AmpSettings } from '../types/amp';
import { DEFAULT_SETTINGS } from '../types/amp';
import type { AssetRef, RigSnapshot } from '../types/preset';
import { notifyError } from '../notifications';
import {
  setBass as tauriSetBass,
  setMiddle as tauriSetMiddle,
  setTreble as tauriSetTreble,
  setPreamp as tauriSetPreamp,
  setMasterVolume as tauriSetMasterVolume,
  setReverb as tauriSetReverb,
  setNoiseGate as tauriSetNoiseGate,
  togglePower as tauriTogglePower,
  clearNam as tauriClearNam,
  clearIr as tauriClearIr,
} from '../tauri';

/**
 * Single source of truth for everything a preset captures: the seven front-panel
 * knobs plus the currently loaded NAM and IR. Power is intentionally excluded.
 */
export function useRigState() {
  const [settings, setSettings] = useState<AmpSettings>(DEFAULT_SETTINGS);
  const [model, setModel] = useState<AssetRef | null>(null);
  const [ir, setIr] = useState<AssetRef | null>(null);

  const setInputVolume = useCallback(async (value: number) => {
    setSettings((prev) => ({ ...prev, inputVolume: value }));
    try {
      await tauriSetPreamp(value / 10);
    } catch (err) {
      console.error('Failed to set input volume:', err);
      notifyError('Could not change the input trim.');
    }
  }, []);

  const setGate = useCallback(async (value: number) => {
    setSettings((prev) => ({ ...prev, gate: value }));
    try {
      const enabled = value > 0;
      const thresholdDb = -80 + value * 6;
      await tauriSetNoiseGate(enabled, thresholdDb, 120);
    } catch (err) {
      console.error('Failed to set noise gate:', err);
      notifyError('Could not change the noise gate.');
    }
  }, []);

  const setBass = useCallback(async (value: number) => {
    setSettings((prev) => ({ ...prev, bass: value }));
    try {
      await tauriSetBass(value / 10);
    } catch (err) {
      console.error('Failed to set bass:', err);
      notifyError('Could not change the bass control.');
    }
  }, []);

  const setMiddle = useCallback(async (value: number) => {
    setSettings((prev) => ({ ...prev, middle: value }));
    try {
      await tauriSetMiddle(value / 10);
    } catch (err) {
      console.error('Failed to set middle:', err);
      notifyError('Could not change the middle control.');
    }
  }, []);

  const setTreble = useCallback(async (value: number) => {
    setSettings((prev) => ({ ...prev, treble: value }));
    try {
      await tauriSetTreble(value / 10);
    } catch (err) {
      console.error('Failed to set treble:', err);
      notifyError('Could not change the treble control.');
    }
  }, []);

  const setOutputVolume = useCallback(async (value: number) => {
    setSettings((prev) => ({ ...prev, outputVolume: value }));
    try {
      await tauriSetMasterVolume(value / 10);
    } catch (err) {
      console.error('Failed to set output volume:', err);
      notifyError('Could not change the output volume.');
    }
  }, []);

  const setReverb = useCallback(async (value: number) => {
    setSettings((prev) => ({ ...prev, reverb: value }));
    try {
      await tauriSetReverb(value / 10);
    } catch (err) {
      console.error('Failed to set reverb:', err);
      notifyError('Could not change the reverb.');
    }
  }, []);

  const togglePower = useCallback(async () => {
    try {
      const newPower = await tauriTogglePower();
      setSettings((prev) => ({ ...prev, powerOn: newPower }));
    } catch (err) {
      console.error('Failed to toggle power:', err);
      notifyError(`Could not start audio: ${err}`);
    }
  }, []);

  const snapshot = useCallback(
    (): RigSnapshot => ({
      inputVolume: settings.inputVolume,
      gate: settings.gate,
      bass: settings.bass,
      middle: settings.middle,
      treble: settings.treble,
      outputVolume: settings.outputVolume,
      reverb: settings.reverb,
      model,
      ir,
    }),
    [settings, model, ir],
  );

  /** Load bypass: drop the NAM and cabinet IR while leaving the knobs as they are. */
  const clearModelAndIr = useCallback(async () => {
    setModel(null);
    setIr(null);
    try {
      await Promise.all([tauriClearNam(), tauriClearIr()]);
    } catch (err) {
      console.error('Failed to clear NAM/IR:', err);
      notifyError(`Could not clear the loaded model: ${err}`);
    }
  }, []);

  /** Recall a preset: update React state and push the knobs to the backend. */
  const applySnapshot = useCallback(
    (next: RigSnapshot) => {
      setModel(next.model);
      setIr(next.ir);
      void setInputVolume(next.inputVolume);
      void setGate(next.gate);
      void setBass(next.bass);
      void setMiddle(next.middle);
      void setTreble(next.treble);
      void setOutputVolume(next.outputVolume);
      void setReverb(next.reverb);
    },
    [setInputVolume, setGate, setBass, setMiddle, setTreble, setOutputVolume, setReverb],
  );

  return {
    settings,
    model,
    ir,
    setModel,
    setIr,
    setInputVolume,
    setGate,
    setBass,
    setMiddle,
    setTreble,
    setOutputVolume,
    setReverb,
    togglePower,
    snapshot,
    applySnapshot,
    clearModelAndIr,
  };
}

export type RigState = ReturnType<typeof useRigState>;
