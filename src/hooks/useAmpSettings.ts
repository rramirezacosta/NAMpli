import { useState, useCallback } from 'react';
import type { AmpSettings } from '../types/amp';
import { DEFAULT_SETTINGS } from '../types/amp';
import { notifyError } from '../notifications';
import {
  setBass as tauriSetBass,
  setMiddle as tauriSetMiddle,
  setTreble as tauriSetTreble,
  setPreamp as tauriSetPreamp,
  setMasterVolume as tauriSetMasterVolume,
  setNoiseGate as tauriSetNoiseGate,
  togglePower as tauriTogglePower,
} from '../tauri';

export function useAmpSettings() {
  const [settings, setSettings] = useState<AmpSettings>(DEFAULT_SETTINGS);

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

  const togglePower = useCallback(async () => {
    try {
      const newPower = await tauriTogglePower();
      setSettings((prev) => ({ ...prev, powerOn: newPower }));
    } catch (err) {
      console.error('Failed to toggle power:', err);
      notifyError(`Could not start audio: ${err}`);
    }
  }, []);

  return {
    settings,
    setInputVolume,
    setGate,
    setBass,
    setMiddle,
    setTreble,
    setOutputVolume,
    togglePower,
  };
}