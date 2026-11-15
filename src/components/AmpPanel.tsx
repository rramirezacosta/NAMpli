import Knob from './Knob';
import './AmpPanel.css';

interface AmpPanelProps {
  gainLevel: number;
  preampVolume: number;
  presence: number;
  bass: number;
  middle: number;
  treble: number;
  masterVolume: number;
  powerOn: boolean;
  onSetGainLevel: (v: number) => void;
  onSetPreampVolume: (v: number) => void;
  onSetPresence: (v: number) => void;
  onSetBass: (v: number) => void;
  onSetMiddle: (v: number) => void;
  onSetTreble: (v: number) => void;
  onSetMasterVolume: (v: number) => void;
}

export default function AmpPanel({
  gainLevel,
  preampVolume,
  presence,
  bass,
  middle,
  treble,
  masterVolume,
  powerOn,
  onSetGainLevel,
  onSetPreampVolume,
  onSetPresence,
  onSetBass,
  onSetMiddle,
  onSetTreble,
  onSetMasterVolume,
}: AmpPanelProps) {
  return (
    <div className={`amp-panel ${powerOn ? 'power-on' : 'power-off'}`}>
      <div className="panel-header">
        <h1 className="panel-title">JCM800</h1>
        <p className="panel-subtitle">NAM Player</p>
      </div>

      <div className="knob-row">
        <Knob
          label="Gain"
          value={gainLevel}
          onChange={onSetGainLevel}
          description="Selects one of the five captured gain stages (G2..G10)"
        />
        <Knob
          label="Preamp"
          value={preampVolume}
          onChange={onSetPreampVolume}
          description="Input trim: pushes the guitar harder (or softer) into the captured amp. 5 = unity."
        />
        <Knob
          label="Bass"
          value={bass}
          onChange={onSetBass}
          description="Adjusts low frequencies"
        />
        <Knob
          label="Middle"
          value={middle}
          onChange={onSetMiddle}
          description="Adjusts midrange frequencies"
        />
        <Knob
          label="Treble"
          value={treble}
          onChange={onSetTreble}
          description="Adjusts high frequencies"
        />
        <Knob
          label="Presence"
          value={presence}
          onChange={onSetPresence}
          description="Power-amp high-frequency bite around 5 kHz"
        />
        <Knob
          label="Master"
          value={masterVolume}
          onChange={onSetMasterVolume}
          description="Controls overall output volume"
        />
      </div>
    </div>
  );
}
