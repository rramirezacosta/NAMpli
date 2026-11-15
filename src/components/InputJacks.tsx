import './InputJacks.css';

interface InputJacksProps {
  inputSensitivity: 'high' | 'low';
  onChange: (sensitivity: 'high' | 'low') => void;
  disabled?: boolean;
}

// #TODO: Apply input sensitivity to audio input chain
// When live audio input is integrated, switching between High and Low
// should adjust the input gain/preamp level accordingly.

export default function InputJacks({
  inputSensitivity,
  onChange,
  disabled = false,
}: InputJacksProps) {
  return (
    <div className="input-jacks">
      <label className="input-jacks-label">Input</label>
      <div className="jack-buttons">
        <button
          className={`jack-btn ${inputSensitivity === 'high' ? 'active' : ''} ${disabled ? 'disabled' : ''}`}
          onClick={() => onChange('high')}
          disabled={disabled}
        >
          HIGH
        </button>
        <button
          className={`jack-btn ${inputSensitivity === 'low' ? 'active' : ''} ${disabled ? 'disabled' : ''}`}
          onClick={() => onChange('low')}
          disabled={disabled}
        >
          LOW
        </button>
      </div>
    </div>
  );
}
