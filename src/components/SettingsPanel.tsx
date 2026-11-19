import { useState, useEffect, useRef } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import {
  listAudioDevices as tauriListDevices,
  listAudioHosts as tauriListAudioHosts,
  listNamModels as tauriListNamModels,
  setAudioDevices as tauriSetAudioDevices,
  setAudioHost as tauriSetAudioHost,
  setBufferSize as tauriSetBufferSize,
  setNamModel as tauriSetNamModel,
  getAudioStatus as tauriGetAudioStatus,
  setNoiseGate as tauriSetNoiseGate,
  loadIr as tauriLoadIr,
  clearIr as tauriClearIr,
  setIrMix as tauriSetIrMix,
  listPresets as tauriListPresets,
  savePreset as tauriSavePreset,
  loadPreset as tauriLoadPreset,
  deletePreset as tauriDeletePreset,
  loadNamByPath as tauriLoadNamByPath,
  logToTerminal,
} from '../tauri';
import type { AudioDeviceInfo } from '../tauri';
import { notifyError } from '../notifications';
import './SettingsPanel.css';

import type { AmpSettings } from '../types/amp';
import type { PresetSlotInfo } from '../types/preset';
import { setPresetBarActions } from '../presets/presetBarStore';

/** Log to both the browser console and the backend OS terminal. */
function log(msg: string) {
  console.log(msg);
  void logToTerminal(msg);
}

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  onSaveUnnamed: () => void;
  settings: AmpSettings;
  onSetInputVolume: (v: number) => void;
  onSetGate: (v: number) => void;
  onSetBass: (v: number) => void;
  onSetMiddle: (v: number) => void;
  onSetTreble: (v: number) => void;
  onSetOutputVolume: (v: number) => void;
}

const BUFFER_SIZE_OPTIONS = [
  { value: 64, label: '64 samples (~1.3ms)' },
  { value: 128, label: '128 samples (~2.7ms)' },
  { value: 256, label: '256 samples (~5ms)' },
  { value: 512, label: '512 samples (~11ms)' },
  { value: 768, label: '768 samples (~16ms)' },
  { value: 1024, label: '1024 samples (~21ms)' },
  { value: 1536, label: '1536 samples (~32ms)' },
  { value: 2048, label: '2048 samples (~43ms)' },
  { value: 3072, label: '3072 samples (~64ms)' },
  { value: 4096, label: '4096 samples (~85ms)' },
  { value: 6144, label: '6144 samples (~128ms)' },
  { value: 8192, label: '8192 samples (~171ms)' },
];

export default function SettingsPanel({
  open: isOpen,
  onClose,
  onSaveUnnamed,
  settings,
  onSetInputVolume,
  onSetGate,
  onSetBass,
  onSetMiddle,
  onSetTreble,
  onSetOutputVolume,
}: SettingsPanelProps) {
  const [selectedNamModel, setSelectedNamModel] = useState<number>(0);
  const [hosts, setHosts] = useState<string[]>([]);
  const [selectedHost, setSelectedHost] = useState<string>('');
  const [inputDevices, setInputDevices] = useState<AudioDeviceInfo[]>([]);
  const [outputDevices, setOutputDevices] = useState<AudioDeviceInfo[]>([]);
  const [selectedInput, setSelectedInput] = useState<string>('');
  const [selectedOutput, setSelectedOutput] = useState<string>('');
  const [bufferSize, setBufferSize] = useState<number>(256);

  const [namModels, setNamModels] = useState<string[]>([]);
  const [presets, setPresets] = useState<string[]>([]);
  const [selectedPreset, setSelectedPreset] = useState<string>('');
  const [presetName, setPresetName] = useState<string>('');

  const [irName, setIrName] = useState<string | null>(null);
  const [irPath, setIrPath] = useState<string | null>(null);
  const [irMix, setIrMix] = useState<number>(100);

  const [gateEnabled, setGateEnabled] = useState<boolean>(false);
  const [gateThreshold, setGateThreshold] = useState<number>(-60);
  const [gateDecay, setGateDecay] = useState<number>(120);

  // Unnamed mode state
  const [isUnnamed, setIsUnnamed] = useState<boolean>(false);
  const [unnamedModelName, setUnnamedModelName] = useState<string | null>(null);
  const [unnamedIrName, setUnnamedIrName] = useState<string | null>(null);
  const [unnamedNamPath, setUnnamedNamPath] = useState<string | null>(null);
  const [unnamedIrPath, setUnnamedIrPath] = useState<string | null>(null);

  // Placeholder refs — initialized after the handler functions are defined below.
  const handleLoadUnnamedNamRef = useRef<((path: string) => Promise<void>) | null>(null);
  const handleLoadUnnamedIrRef = useRef<((path: string) => Promise<void>) | null>(null);

  // Listen for custom events from App.tsx when files are dropped
  useEffect(() => {
    log('>>> UNNAMED MODE: SettingsPanel registering event listeners');
    const handleNamEvent = (e: Event) => {
      const path = (e as CustomEvent).detail as string;
      log('>>> UNNAMED MODE: received load-unnamed-nam event, path=', path);
      if (handleLoadUnnamedNamRef.current) {
        void handleLoadUnnamedNamRef.current(path);
      }
    };
    const handleIrEvent = (e: Event) => {
      const path = (e as CustomEvent).detail as string;
      log('>>> UNNAMED MODE: received load-unnamed-ir event, path=', path);
      if (handleLoadUnnamedIrRef.current) {
        void handleLoadUnnamedIrRef.current(path);
      }
    };
    window.addEventListener('load-unnamed-nam', handleNamEvent);
    window.addEventListener('load-unnamed-ir', handleIrEvent);
    return () => {
      log('>>> UNNAMED MODE: SettingsPanel cleaning up event listeners');
      window.removeEventListener('load-unnamed-nam', handleNamEvent);
      window.removeEventListener('load-unnamed-ir', handleIrEvent);
    };
  }, []);

  // Build slot info from presets list
  const slots: PresetSlotInfo[] = presets.map((name) => ({
    slot: name,
    name,
    modelName: null,
    irName: null,
  }));

  // Update preset bar store
  useEffect(() => {
    log('>>> UNNAMED MODE: setPresetBarActions — isUnnamed=', isUnnamed, ', unnamedModelName=', unnamedModelName);
    setPresetBarActions({
      slots,
      currentSlot: isUnnamed ? null : (selectedPreset || null),
      isDirty: false,
      modelName: isUnnamed ? unnamedModelName : null,
      irName: isUnnamed ? unnamedIrName : (irName || null),
      loadSlot: (slot: string) => {
        void handleLoadSlot(slot);
      },
      isUnnamed,
      unnamedModelName,
      unnamedIrName,
      saveUnnamed: () => {
        void handleSaveUnnamed();
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots, selectedPreset, isUnnamed, unnamedModelName, unnamedIrName, irName]);

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;

    const load = async () => {
      try {
        const availableHosts = await tauriListAudioHosts();
        if (cancelled) return;
        setHosts(availableHosts);

        const host = selectedHost || availableHosts[0] || '';
        if (!selectedHost && host) setSelectedHost(host);

        const models = await tauriListNamModels();
        if (cancelled) return;
        setNamModels(models);

        const presetList = await tauriListPresets();
        if (cancelled) return;
        setPresets(presetList);
        if (presetList.length && !selectedPreset) setSelectedPreset(presetList[0]);

        try {
          const status = await tauriGetAudioStatus();
          if (!cancelled && status.namModel) {
            const idx = models.indexOf(status.namModel);
            if (idx >= 0) setSelectedNamModel(idx);
          }
          if (!cancelled && status.irName) setIrName(status.irName);
        } catch {
          // ignore
        }

        const devices = await tauriListDevices(host || undefined);
        if (cancelled) return;
        setInputDevices(devices.inputs);
        setOutputDevices(devices.outputs);

        // Prefer the system default; do not silently pick the first ALSA plugin
        // (which is often the useless "null"/"sysdefault" endpoint).
        const inputFallback =
          devices.defaultInput ??
          devices.inputs.find((d) => d.isDefault)?.id ??
          devices.inputs[0]?.id;
        const outputFallback =
          devices.defaultOutput ??
          devices.outputs.find((d) => d.isDefault)?.id ??
          devices.outputs[0]?.id;
        setSelectedInput((prev) => prev || inputFallback || '');
        setSelectedOutput((prev) => prev || outputFallback || '');
      } catch (err) {
        console.error('Failed to enumerate audio devices:', err);
        notifyError(`Could not list audio devices: ${err}`);
      }
    };

    const loadStatus = async () => {
      try {
        const status = await tauriGetAudioStatus();
        if (cancelled) return;
        if (status.irName) setIrName(status.irName);
        if (status.namModel && namModels.length) {
          const idx = namModels.indexOf(status.namModel);
          if (idx >= 0) setSelectedNamModel(idx);
        }
      } catch {
        // Status is best-effort; the panel still works without it.
      }
    };

    void load();
    void loadStatus();

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  // Keep the backend in sync with the device picker. If the amp is powered on,
  // this restarts the streams so the new device takes effect immediately.
  useEffect(() => {
    if (!selectedInput || !selectedOutput) return;
    tauriSetAudioDevices(selectedInput, selectedOutput).catch((err) => {
      console.error('Failed to set audio devices:', err);
      notifyError(`Could not select audio devices: ${err}`);
    });
  }, [selectedInput, selectedOutput]);

  const handleSelectInput = (deviceId: string) => {
    setSelectedInput(deviceId);
  };

  const handleSelectOutput = (deviceId: string) => {
    setSelectedOutput(deviceId);
  };

  const handleSavePreset = async () => {
    const name = presetName.trim();
    if (!name) {
      notifyError('Enter a preset name first.');
      return;
    }
    const content = JSON.stringify({
      modelIndex: selectedNamModel,
      inputVolume: settings.inputVolume,
      gate: settings.gate,
      bass: settings.bass,
      middle: settings.middle,
      treble: settings.treble,
      outputVolume: settings.outputVolume,
      bufferSize,
    });
    try {
      await tauriSavePreset(name, content);
      const list = await tauriListPresets();
      setPresets(list);
      setSelectedPreset(name);
    } catch (err) {
      console.error('Failed to save preset:', err);
      notifyError(`Could not save preset: ${err}`);
    }
  };

  const handleLoadSlot = async (slot: string) => {
    try {
      const raw = await tauriLoadPreset(slot);
      const preset = JSON.parse(raw);
      if (typeof preset.inputVolume === 'number') onSetInputVolume(preset.inputVolume);
      if (typeof preset.gate === 'number') onSetGate(preset.gate);
      if (typeof preset.bass === 'number') onSetBass(preset.bass);
      if (typeof preset.middle === 'number') onSetMiddle(preset.middle);
      if (typeof preset.treble === 'number') onSetTreble(preset.treble);
      if (typeof preset.outputVolume === 'number') onSetOutputVolume(preset.outputVolume);
      if (typeof preset.bufferSize === 'number') {
        setBufferSize(preset.bufferSize);
        tauriSetBufferSize(preset.bufferSize).catch(() => {});
      }
      if (typeof preset.modelIndex === 'number') {
        setSelectedNamModel(preset.modelIndex);
        tauriSetNamModel(preset.modelIndex).catch(() => {});
      }
      setSelectedPreset(slot);
      // Clear unnamed state when loading a slot
      setIsUnnamed(false);
      setUnnamedModelName(null);
      setUnnamedIrName(null);
      setUnnamedNamPath(null);
      setUnnamedIrPath(null);
    } catch (err) {
      console.error('Failed to load preset:', err);
      notifyError(`Could not load preset: ${err}`);
    }
  };

  const handleLoadPreset = async () => {
    if (!selectedPreset) return;
    await handleLoadSlot(selectedPreset);
  };

  const handleDeletePreset = async () => {
    if (!selectedPreset) return;
    try {
      await tauriDeletePreset(selectedPreset);
      const list = await tauriListPresets();
      setPresets(list);
      setSelectedPreset(list.length ? list[0] : '');
    } catch (err) {
      console.error('Failed to delete preset:', err);
      notifyError(`Could not delete preset: ${err}`);
    }
  };

  const handleSetNamModel = async (index: number) => {
    setSelectedNamModel(index);
    try {
      await tauriSetNamModel(index);
    } catch (err) {
      console.error('Failed to set NAM model:', err);
      notifyError(`Could not change NAM model: ${err}`);
    }
  };

  const handleSelectHost = async (host: string) => {
    setSelectedHost(host);
    setSelectedInput('');
    setSelectedOutput('');
    try {
      await tauriSetAudioHost(host || undefined);
      const devices = await tauriListDevices(host || undefined);
      setInputDevices(devices.inputs);
      setOutputDevices(devices.outputs);
      const inputFallback =
        devices.defaultInput ??
        devices.inputs.find((d) => d.isDefault)?.id ??
        devices.inputs[0]?.id;
      const outputFallback =
        devices.defaultOutput ??
        devices.outputs.find((d) => d.isDefault)?.id ??
        devices.outputs[0]?.id;
      setSelectedInput(inputFallback || '');
      setSelectedOutput(outputFallback || '');
    } catch (err) {
      console.error('Failed to switch audio host:', err);
      notifyError(`Could not switch audio host: ${err}`);
    }
  };

  const handleSetBufferSize = async (size: number) => {
    setBufferSize(size);
    try {
      await tauriSetBufferSize(size);
    } catch (err) {
      console.error('Failed to set buffer size:', err);
      notifyError(`Could not change latency: ${err}`);
    }
  };

  const handleLoadIr = async () => {
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        filters: [{ name: 'Cabinet Impulse Response (WAV)', extensions: ['wav'] }],
      });
      if (!selected || Array.isArray(selected)) return;
      const name = await tauriLoadIr(selected);
      setIrName(name);
      setIrPath(selected);
    } catch (err) {
      console.error('Failed to load cabinet IR:', err);
      notifyError(`Could not load that impulse response: ${err}`);
    }
  };

  // --- Unnamed mode handlers ---

  const handleLoadUnnamedNam = async (path: string) => {
    try {
      log('>>> UNNAMED MODE: handleLoadUnnamedNam START, path=', path);
      const fileName = path.split('/').pop() ?? path.split('\\').pop() ?? path;
      const modelName = fileName.replace(/\.nam$/i, '');
      log('>>> UNNAMED MODE: extracted modelName=', modelName);
      // Set unnamed state first, before loading into audio engine (which may fail)
      setUnnamedModelName(modelName);
      setUnnamedNamPath(path);
      setUnnamedIrName(unnamedIrName);
      setUnnamedIrPath(unnamedIrPath);
      setIsUnnamed(true);
      setSelectedPreset('');
      setIrName(unnamedIrName);
      setIrPath(unnamedIrPath);
      log('>>> UNNAMED MODE ACTIVATED: isUnnamed=true, modelName=', modelName);
      // Load into audio engine (best-effort)
      try {
        const loadedName = await tauriLoadNamByPath(path);
        log('>>> UNNAMED MODE: NAM loaded into audio engine as', loadedName);
      } catch (loadErr) {
        log('>>> UNNAMED MODE: tauriLoadNamByPath failed (audio engine may not be running):', loadErr);
      }
      log('>>> UNNAMED MODE: handleLoadUnnamedNam completed');
    } catch (err) {
      console.error('>>> UNNAMED MODE: handleLoadUnnamedNam FAILED', err);
      notifyError(`Could not load NAM file: ${err}`);
    }
  };

  const handleLoadUnnamedIr = async (path: string) => {
    try {
      log('>>> UNNAMED MODE: handleLoadUnnamedIr START, path=', path);
      const fileName = path.split('/').pop() ?? path.split('\\').pop() ?? path;
      const irNameFromFile = fileName.replace(/\.wav$/i, '');
      setUnnamedIrName(irNameFromFile);
      setUnnamedIrPath(path);
      setIrName(irNameFromFile);
      setIrPath(path);
      setIsUnnamed(true);
      setSelectedPreset('');
      log('>>> UNNAMED MODE ACTIVATED: isUnnamed=true, irName=', irNameFromFile);
      try {
        const irNameLoaded = await tauriLoadIr(path);
        log('>>> UNNAMED MODE: IR loaded into audio engine as', irNameLoaded);
        setUnnamedIrName(irNameLoaded);
        setIrName(irNameLoaded);
      } catch (loadErr) {
        log('>>> UNNAMED MODE: tauriLoadIr failed (audio engine may not be running):', loadErr);
      }
      log('>>> UNNAMED MODE: handleLoadUnnamedIr completed');
    } catch (err) {
      console.error('>>> UNNAMED MODE: handleLoadUnnamedIr FAILED', err);
      notifyError(`Could not load IR file: ${err}`);
    }
  };

  const handleSaveUnnamed = () => {
    log('>>> UNNAMED MODE: handleSaveUnnamed — opening preset library');
    onSaveUnnamed();
  };

  // Initialize refs so event listeners always call the latest handler version.
  handleLoadUnnamedNamRef.current = handleLoadUnnamedNam;
  handleLoadUnnamedIrRef.current = handleLoadUnnamedIr;

  const handleClearIr = async () => {
    try {
      await tauriClearIr();
      setIrName(null);
      setIrPath(null);
    } catch (err) {
      console.error('Failed to clear cabinet IR:', err);
      notifyError('Could not remove the cabinet IR.');
    }
  };

  const handleIrMix = (value: number) => {
    setIrMix(value);
    tauriSetIrMix(value / 100).catch((err) => {
      console.error('Failed to set IR mix:', err);
    });
  };

  const pushGateSettings = (enabled: boolean, threshold: number, decay: number) => {
    tauriSetNoiseGate(enabled, threshold, decay).catch((err) => {
      console.error('Failed to set noise gate:', err);
      notifyError('Could not update the noise gate.');
    });
  };

  const handleGateToggle = (enabled: boolean) => {
    setGateEnabled(enabled);
    pushGateSettings(enabled, gateThreshold, gateDecay);
  };

  const handleGateThreshold = (threshold: number) => {
    setGateThreshold(threshold);
    pushGateSettings(gateEnabled, threshold, gateDecay);
  };

  const handleGateDecay = (decay: number) => {
    setGateDecay(decay);
    pushGateSettings(gateEnabled, gateThreshold, decay);
  };

  const getInputLabel = () => {
    const device = inputDevices.find((d) => d.id === selectedInput);
    return device?.label || 'No input device';
  };

  const getOutputLabel = () => {
    const device = outputDevices.find((d) => d.id === selectedOutput);
    return device?.label || 'No output device';
  };

  if (!isOpen) return null;

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>Settings</h2>
          <button className="settings-close" onClick={onClose} aria-label="Close settings">
            &times;
          </button>
        </div>

        <div className="settings-section">
          <h3>Presets</h3>

          <div className="setting-row">
            <label className="setting-label">Preset</label>
            <select
              className="setting-select"
              value={selectedPreset}
              onChange={(e) => setSelectedPreset(e.target.value)}
            >
              {presets.length === 0 ? (
                <option value="">No presets saved</option>
              ) : (
                presets.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))
              )}
            </select>
            <span className="setting-value">{selectedPreset || '—'}</span>
          </div>

          <div className="setting-row">
            <label className="setting-label">Name</label>
            <input
              className="setting-select"
              type="text"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              placeholder="New preset name"
            />
          </div>

          <div className="setting-row setting-inline">
            <button className="setting-button" onClick={handleSavePreset}>
              Save
            </button>
            <button className="setting-button" onClick={handleLoadPreset} disabled={!selectedPreset}>
              Load
            </button>
            <button
              className="setting-button setting-button-secondary"
              onClick={handleDeletePreset}
              disabled={!selectedPreset}
            >
              Delete
            </button>
          </div>
        </div>

        <div className="settings-section">
          <h3>Model</h3>

          <div className="setting-row">
            <label className="setting-label">NAM Model</label>
            <select
              className="setting-select"
              value={selectedNamModel}
              onChange={(e) => handleSetNamModel(Number(e.target.value))}
            >
              {namModels.length === 0 ? (
                <option value={0}>No models found</option>
              ) : (
                namModels.map((name, index) => (
                  <option key={name} value={index}>
                    {name.replace('.nam', '')}
                  </option>
                ))
              )}
            </select>
            <span className="setting-value">
              {namModels[selectedNamModel] || ''}
            </span>
          </div>
        </div>

        <div className="settings-section">
          <h3>Audio</h3>

          <div className="setting-row">
            <label className="setting-label">Audio Host</label>
            <select
              className="setting-select"
              value={selectedHost}
              onChange={(e) => handleSelectHost(e.target.value)}
            >
              {hosts.length === 0 ? (
                <option value="">No hosts found</option>
              ) : (
                hosts.map((host) => (
                  <option key={host} value={host}>
                    {host}
                  </option>
                ))
              )}
            </select>
            <span className="setting-value">
              {selectedHost || 'Default host'}
            </span>
          </div>

          <div className="setting-row">
            <label className="setting-label">Input Device</label>
            <select
              className="setting-select"
              value={selectedInput}
              onChange={(e) => handleSelectInput(e.target.value)}
            >
              {inputDevices.length === 0 ? (
                <option value="">No devices found</option>
              ) : (
                inputDevices.map((device) => (
                  <option key={device.id} value={device.id}>
                    {device.label}
                  </option>
                ))
              )}
            </select>
            {inputDevices.length > 0 && (
              <span className="setting-value">{getInputLabel()}</span>
            )}
          </div>

          <div className="setting-row">
            <label className="setting-label">Output Device</label>
            <select
              className="setting-select"
              value={selectedOutput}
              onChange={(e) => handleSelectOutput(e.target.value)}
            >
              {outputDevices.length === 0 ? (
                <option value="">No devices found</option>
              ) : (
                outputDevices.map((device) => (
                  <option key={device.id} value={device.id}>
                    {device.label}
                  </option>
                ))
              )}
            </select>
            {outputDevices.length > 0 && (
              <span className="setting-value">{getOutputLabel()}</span>
            )}
          </div>

          <div className="setting-row">
            <label className="setting-label">Latency</label>
            <select
              className="setting-select"
              value={bufferSize}
              onChange={(e) => handleSetBufferSize(Number(e.target.value))}
            >
              {BUFFER_SIZE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className="setting-value">
              {BUFFER_SIZE_OPTIONS.find((o) => o.value === bufferSize)?.label || ''}
            </span>
          </div>
        </div>

        <div className="settings-section">
          <h3>Cabinet</h3>

          <div className="setting-row">
            <label className="setting-label">Impulse Response</label>
            <div className="setting-inline">
              <button className="setting-button" onClick={handleLoadIr}>
                Load IR&hellip;
              </button>
              {irName && (
                <button className="setting-button setting-button-secondary" onClick={handleClearIr}>
                  Remove
                </button>
              )}
            </div>
            <span className="setting-value">
              {irName ??
                'No cabinet IR loaded. The captures are amp-only, so the raw output will sound bright and fizzy.'}
            </span>
          </div>

          <div className="setting-row">
            <label className="setting-label">Cabinet Mix</label>
            <input
              className="setting-slider"
              type="range"
              min={0}
              max={100}
              step={1}
              value={irMix}
              disabled={!irName}
              onChange={(e) => handleIrMix(Number(e.target.value))}
            />
            <span className="setting-value">
              {irMix}% cabinet &middot; {100 - irMix}% direct
            </span>
          </div>
        </div>

        <div className="settings-section">
          <h3>Noise Gate</h3>

          <div className="setting-row setting-toggle-row">
            <label className="setting-label" htmlFor="gate-enabled">
              Enable
            </label>
            <input
              id="gate-enabled"
              className="setting-checkbox"
              type="checkbox"
              checked={gateEnabled}
              onChange={(e) => handleGateToggle(e.target.checked)}
            />
          </div>

          <div className="setting-row">
            <label className="setting-label">Threshold</label>
            <input
              className="setting-slider"
              type="range"
              min={-80}
              max={-20}
              step={1}
              value={gateThreshold}
              disabled={!gateEnabled}
              onChange={(e) => handleGateThreshold(Number(e.target.value))}
            />
            <span className="setting-value">{gateThreshold} dBFS</span>
          </div>

          <div className="setting-row">
            <label className="setting-label">Decay</label>
            <input
              className="setting-slider"
              type="range"
              min={20}
              max={500}
              step={10}
              value={gateDecay}
              disabled={!gateEnabled}
              onChange={(e) => handleGateDecay(Number(e.target.value))}
            />
            <span className="setting-value">{gateDecay} ms</span>
          </div>
        </div>

      </div>
    </div>
  );
}
