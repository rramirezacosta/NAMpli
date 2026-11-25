interface LibraryIconProps {
  onClick: () => void;
}

export default function LibraryIcon({ onClick }: LibraryIconProps) {
  return (
    <button
      className="tool-button"
      onClick={onClick}
      data-library-trigger
      aria-label="Library"
      title="Library"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M20 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
