interface TunerIconProps {
  onClick: () => void;
}

export default function TunerIcon({ onClick }: TunerIconProps) {
  return (
    <button
      className="tool-button"
      onClick={onClick}
      data-tuner-trigger
      aria-label="Tuner"
      title="Tuner"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M12 3v18M8 7c0-2 1.5-3 4-3s4 1 4 3M8 17c0 2 1.5 3 4 3s4-1 4-3"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="12" cy="12" r="1.5" fill="currentColor" />
      </svg>
    </button>
  );
}
