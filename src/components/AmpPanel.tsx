import Knob from './Knob';
import './AmpPanel.css';

interface AmpPanelProps {
  inputVolume: number;
  gate: number;
  bass: number;
  middle: number;
  treble: number;
  outputVolume: number;
  powerOn: boolean;
  onSetInputVolume: (v: number) => void;
  onSetGate: (v: number) => void;
  onSetBass: (v: number) => void;
  onSetMiddle: (v: number) => void;
  onSetTreble: (v: number) => void;
  onSetOutputVolume: (v: number) => void;
}

export default function AmpPanel({
  inputVolume,
  gate,
  bass,
  middle,
  treble,
  outputVolume,
  powerOn,
  onSetInputVolume,
  onSetGate,
  onSetBass,
  onSetMiddle,
  onSetTreble,
  onSetOutputVolume,
}: AmpPanelProps) {
  return (
    <div className={`amp-panel ${powerOn ? 'power-on' : 'power-off'}`}>
      <div className="panel-header">
        <h1 className="panel-title">JCM800</h1>
        <p className="panel-subtitle">NAMpli</p>
      </div>

      <div className="knob-row">
        <Knob
          label="Input"
          value={inputVolume}
          onChange={onSetInputVolume}
          description="Input trim: pushes the guitar harder (or softer) into the model. 5 = unity."
        />
        <Knob
          label="Gate"
          value={gate}
          onChange={onSetGate}
          description="Noise gate threshold. 0 = off."
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
          label="Output"
          value={outputVolume}
          onChange={onSetOutputVolume}
          description="Controls overall output volume"
        />
      </div>
    </div>
  );
}