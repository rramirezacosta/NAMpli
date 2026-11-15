import { useState, useEffect } from 'react';
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
} from '../tauri';
import type { AudioDeviceInfo } from '../tauri';
import { notifyError } from '../notifications';
import './SettingsPanel.css';

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
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

export default function SettingsPanel({ open: isOpen, onClose }: SettingsPanelProps) {
  const [hosts, setHosts] = useState<string[]>([]);
  const [selectedHost, setSelectedHost] = useState<string>('');
  const [inputDevices, setInputDevices] = useState<AudioDeviceInfo[]>([]);
  const [outputDevices, setOutputDevices] = useState<AudioDeviceInfo[]>([]);
  const [selectedInput, setSelectedInput] = useState<string>('');
  const [selectedOutput, setSelectedOutput] = useState<string>('');
  const [bufferSize, setBufferSize] = useState<number>(256);

  const [namModels, setNamModels] = useState<string[]>([]);
  const [selectedNamModel, setSelectedNamModel] = useState<number>(0);

  const [irName, setIrName] = useState<string | null>(null);
  const [irMix, setIrMix] = useState<number>(100);

  const [gateEnabled, setGateEnabled] = useState<boolean>(false);
  const [gateThreshold, setGateThreshold] = useState<number>(-60);
  const [gateDecay, setGateDecay] = useState<number>(120);

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
    } catch (err) {
      console.error('Failed to load cabinet IR:', err);
      notifyError(`Could not load that impulse response: ${err}`);
    }
  };

  const handleClearIr = async () => {
    try {
      await tauriClearIr();
      setIrName(null);
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
