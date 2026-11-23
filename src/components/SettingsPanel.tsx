import { useState, useEffect, useRef } from 'react';
import {
  listAudioDevices as tauriListDevices,
  listAudioHosts as tauriListAudioHosts,
  setAudioDevices as tauriSetAudioDevices,
  setAudioHost as tauriSetAudioHost,
  setBufferSize as tauriSetBufferSize,
} from '../tauri';
import type { AudioDeviceInfo } from '../tauri';
import { notifyError } from '../notifications';
import { useDialogFocus } from '../hooks/useDialogFocus';
import './SettingsPanel.css';

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  backgroundEnabled: boolean;
  backgroundIntensity: number;
  onSetBackgroundEnabled: (enabled: boolean) => void;
  onSetBackgroundIntensity: (intensity: number) => void;
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
  backgroundEnabled,
  backgroundIntensity,
  onSetBackgroundEnabled,
  onSetBackgroundIntensity,
}: SettingsPanelProps) {
  const [hosts, setHosts] = useState<string[]>([]);
  const [selectedHost, setSelectedHost] = useState<string>('');
  const [inputDevices, setInputDevices] = useState<AudioDeviceInfo[]>([]);
  const [outputDevices, setOutputDevices] = useState<AudioDeviceInfo[]>([]);
  const [selectedInput, setSelectedInput] = useState<string>('');
  const [selectedOutput, setSelectedOutput] = useState<string>('');
  const [bufferSize, setBufferSize] = useState<number>(256);

  const panelRef = useRef<HTMLDivElement>(null);
  useDialogFocus(isOpen, onClose, panelRef);

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

    void load();

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
      <div
        className="settings-panel"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-header">
          <h2 id="settings-title">Settings</h2>
          <button className="settings-close" onClick={onClose} aria-label="Close settings">
            &times;
          </button>
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
          <h3>Visualization</h3>

          <div className="setting-row">
            <label className="setting-label" htmlFor="background-visualization-enabled">
              Background visualization
            </label>
            <input
              id="background-visualization-enabled"
              className="settings-checkbox"
              type="checkbox"
              checked={backgroundEnabled}
              onChange={(e) => onSetBackgroundEnabled(e.target.checked)}
            />
            <span className="setting-value">
              Ambient waveform and spectrum behind the faceplate.
            </span>
          </div>

          <div className="setting-row">
            <label className="setting-label" htmlFor="background-visualization-intensity">
              Intensity
            </label>
            <input
              id="background-visualization-intensity"
              className="settings-range"
              type="range"
              min={0}
              max={100}
              value={backgroundIntensity}
              disabled={!backgroundEnabled}
              onChange={(e) => onSetBackgroundIntensity(Number(e.target.value))}
            />
            <span className="setting-value">{backgroundIntensity}%</span>
          </div>
        </div>
      </div>
    </div>
  );
}
