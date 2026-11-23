interface VisualizationIconProps {
  onClick: () => void;
}

/** Tool button that opens the Scope popup. */
export default function VisualizationIcon({ onClick }: VisualizationIconProps) {
  return (
    <button
      className="tool-button"
      onClick={onClick}
      aria-label="Scope"
      title="Scope — sound visualization"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M2 12h3l2-6 3 12 3-9 2 6 2-3h5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
