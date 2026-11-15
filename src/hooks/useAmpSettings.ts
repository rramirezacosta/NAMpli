import { useState, useCallback } from 'react';
import type { AmpSettings } from '../types/amp';
import { DEFAULT_SETTINGS } from '../types/amp';
import { notifyError } from '../notifications';
import {
  setBass as tauriSetBass,
  setMiddle as tauriSetMiddle,
  setTreble as tauriSetTreble,
  setPresence as tauriSetPresence,
  setPreamp as tauriSetPreamp,
  setMasterVolume as tauriSetMasterVolume,
  setGainLevel as tauriSetGainLevel,
  setSensitivity as tauriSetSensitivity,
  togglePower as tauriTogglePower,
} from '../tauri';

export function useAmpSettings() {
  const [settings, setSettings] = useState<AmpSettings>(DEFAULT_SETTINGS);

  const setPreampVolume = useCallback(async (value: number) => {
    setSettings((prev) => ({ ...prev, preampVolume: value }));
    try {
      // Input trim: 0-10 maps to -12..+12 dB around the 5 (unity) midpoint.
      await tauriSetPreamp(value / 10);
    } catch (err) {
      console.error('Failed to set preamp volume:', err);
      notifyError('Could not change the input trim.');
    }
  }, []);

  const setBass = useCallback(async (value: number) => {
    setSettings((prev) => ({ ...prev, bass: value }));
    try {
      // Knobs are 0-10; the audio engine expects normalized 0-1 values.
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

  const setPresence = useCallback(async (value: number) => {
    setSettings((prev) => ({ ...prev, presence: value }));
    try {
      await tauriSetPresence(value / 10);
    } catch (err) {
      console.error('Failed to set presence:', err);
      notifyError('Could not change the presence control.');
    }
  }, []);

  const setMasterVolume = useCallback(async (value: number) => {
    setSettings((prev) => ({ ...prev, masterVolume: value }));
    try {
      // Knobs are 0-10; the audio engine expects normalized 0-1 values.
      await tauriSetMasterVolume(value / 10);
    } catch (err) {
      console.error('Failed to set master volume:', err);
      notifyError('Could not change the master volume.');
    }
  }, []);

  const setGainLevel = useCallback(async (level: number) => {
    setSettings((prev) => ({ ...prev, gainLevel: level }));
    try {
      // The 0-10 knob maps onto the 5 captured model gain levels (G2..G10).
      const modelLevel = Math.min(5, Math.max(1, Math.round(level / 2)));
      await tauriSetGainLevel(modelLevel);
    } catch (err) {
      console.error('Failed to set gain level:', err);
      notifyError('Could not change the gain level.');
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

  const setInputSensitivity = useCallback(async (sensitivity: 'high' | 'low') => {
    setSettings((prev) => ({ ...prev, inputSensitivity: sensitivity }));
    try {
      await tauriSetSensitivity(sensitivity);
    } catch (err) {
      console.error('Failed to set sensitivity:', err);
      notifyError('Could not change the input sensitivity.');
    }
  }, []);

  return {
    settings,
    setPreampVolume,
    setBass,
    setMiddle,
    setTreble,
    setPresence,
    setMasterVolume,
    setGainLevel,
    togglePower,
    setInputSensitivity,
  };
}
