import './PowerSwitch.css';

interface PowerSwitchProps {
  powerOn: boolean;
  onToggle: () => void;
}

export default function PowerSwitch({ powerOn, onToggle }: PowerSwitchProps) {
  return (
    <div className="power-switch">
      <button
        className={`power-btn ${powerOn ? 'on' : 'off'}`}
        onClick={onToggle}
        aria-pressed={powerOn}
        aria-label={powerOn ? 'Power off' : 'Power on'}
        title={powerOn ? 'Power off' : 'Power on'}
      >
        <span className="power-icon" aria-hidden="true">⏻</span>
        <span className="power-label">{powerOn ? 'ON' : 'STANDBY'}</span>
      </button>
      <span
        className={`power-led ${powerOn ? 'lit' : 'dark'}`}
        title={powerOn ? 'Amplifier on' : 'Amplifier in standby'}
      />
    </div>
  );
}
