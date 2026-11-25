import Knob from './Knob';
import LevelMeter from './LevelMeter';
import PresetBar from './PresetBar';
import PowerSwitch from './PowerSwitch';
import type { PresetManager } from '../hooks/usePresetManager';
import type { MeterSnapshot } from '../tauri';
import './AmpPanel.css';

interface AmpPanelProps {
  inputVolume: number;
  gate: number;
  bass: number;
  middle: number;
  treble: number;
  outputVolume: number;
  reverb: number;
  powerOn: boolean;
  modelName: string | null;
  irName: string | null;
  meters: MeterSnapshot | null;
  presetManager: PresetManager;
  onOpenLibrary: () => void;
  onTogglePower: () => void;
  onSetInputVolume: (v: number) => void;
  onSetGate: (v: number) => void;
  onSetBass: (v: number) => void;
  onSetMiddle: (v: number) => void;
  onSetTreble: (v: number) => void;
  onSetOutputVolume: (v: number) => void;
  onSetReverb: (v: number) => void;
}

export default function AmpPanel({
  inputVolume,
  gate,
  bass,
  middle,
  treble,
  outputVolume,
  reverb,
  powerOn,
  modelName,
  irName,
  meters,
  presetManager,
  onOpenLibrary,
  onTogglePower,
  onSetInputVolume,
  onSetGate,
  onSetBass,
  onSetMiddle,
  onSetTreble,
  onSetOutputVolume,
  onSetReverb,
}: AmpPanelProps) {
  const modelLabel = modelName?.replace(/\.nam$/i, '') ?? 'none';
  const irLabel = irName?.replace(/\.wav$/i, '') ?? 'none';
  const state = !powerOn ? 'standby' : modelName ? 'live' : 'bypass';
  const stateLabel = state.toUpperCase();

  return (
    <div className={`amp-panel ${powerOn ? 'power-on' : 'power-off'}`}>
      {/* Presets are the primary interaction surface, so they lead the panel. */}
      <div className="preset-rail">
        <PresetBar manager={presetManager} onOpenLibrary={onOpenLibrary} />
      </div>

      <div className="panel-header">
        <div className="panel-title-group">
          <h1 className="panel-title">NAMpli</h1>
          <div className="panel-readout">
            <span className={`state-pill ${state}`} title={stateLabel}>
              {stateLabel}
            </span>
            <span className="readout-item" title={modelLabel}>
              MODEL: {modelLabel}
            </span>
            <span className="readout-separator">·</span>
            <span className="readout-item" title={irLabel}>
              IR: {irLabel}
            </span>
          </div>
        </div>
      </div>

      <div className="knob-row">
        <LevelMeter label="IN" reading={meters?.input ?? null} active={powerOn} />

        <section className="knob-group" aria-label="Input and gate">
          <h2 className="knob-group-title">Input / Gate</h2>
          <div className="knob-group-controls">
            <Knob
              label="Input"
              value={inputVolume}
              onChange={onSetInputVolume}
              hint="Drive into model"
              description="Input trim: pushes the guitar harder (or softer) into the model. 5 = unity."
            />
            <Knob
              label="Gate"
              value={gate}
              onChange={onSetGate}
              hint="Noise threshold"
              description="Noise gate threshold. 0 = off."
            />
          </div>
        </section>

        <section className="knob-group" aria-label="Equalizer">
          <h2 className="knob-group-title">Equalizer</h2>
          <div className="knob-group-controls">
            <Knob
              label="Bass"
              value={bass}
              onChange={onSetBass}
              hint="Low frequencies"
              description="Adjusts low frequencies"
            />
            <Knob
              label="Middle"
              value={middle}
              onChange={onSetMiddle}
              hint="Mid frequencies"
              description="Adjusts midrange frequencies"
            />
            <Knob
              label="Treble"
              value={treble}
              onChange={onSetTreble}
              hint="High frequencies"
              description="Adjusts high frequencies"
            />
          </div>
        </section>

        <section className="knob-group" aria-label="Output">
          <h2 className="knob-group-title">Output</h2>
          <div className="knob-group-controls">
            <Knob
              label="Output"
              value={outputVolume}
              onChange={onSetOutputVolume}
              hint="Master volume"
              description="Controls overall output volume"
            />
            <Knob
              label="Reverb"
              value={reverb}
              onChange={onSetReverb}
              hint="Room ambience"
              description="Room reverb. 0 = off."
            />
          </div>
        </section>

        <LevelMeter label="OUT" reading={meters?.output ?? null} active={powerOn} />
      </div>

      <div className="panel-footer">
        <PowerSwitch powerOn={powerOn} onToggle={onTogglePower} />
        <div className="panel-footer-status">
          <span className={`footer-chip ${irName ? 'on' : ''}`}>
            {irName ? 'CAB ON' : 'NO CAB'}
          </span>
          <span className="footer-hint">Drop a .nam or .wav file to load</span>
        </div>
      </div>
    </div>
  );
}
