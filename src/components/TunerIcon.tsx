import './TunerIcon.css';

interface TunerIconProps {
  onClick: () => void;
}

export default function TunerIcon({ onClick }: TunerIconProps) {
  return (
    <button className="tuner-icon" onClick={onClick} aria-label="Tuner">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          d="M12 3v18M8 7c0-2 1.5-3 4-3s4 1 4 3M8 17c0 2 1.5 3 4 3s4-1 4-3"
          stroke="#d4af37"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="12" cy="12" r="1.5" fill="#d4af37" />
      </svg>
    </button>
  );
}