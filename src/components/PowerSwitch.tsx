import './PowerSwitch.css';

interface PowerSwitchProps {
  powerOn: boolean;
  onToggle: () => void;
}

// #TODO: Initialize WASM audio engine on power on
// When the NAM engine is integrated, toggling power on should:
// 1. Initialize the neural-amp-modeler-wasm engine
// 2. Request audio context from the browser
// 3. Load the current NAM model
// 4. Start the audio processing chain

// #TODO: Clean up audio resources on power off
// When toggling power off, release audio context and stop processing

export default function PowerSwitch({ powerOn, onToggle }: PowerSwitchProps) {
  return (
    <div className="power-switch">
      <button
        className={`power-btn ${powerOn ? 'on' : 'off'}`}
        onClick={onToggle}
        aria-pressed={powerOn}
      >
        <span className="power-icon">⏻</span>
        <span className="power-label">{powerOn ? 'ON' : 'STANDBY'}</span>
      </button>
      <div className={`power-led ${powerOn ? 'lit' : 'dark'}`} />
    </div>
  );
}
