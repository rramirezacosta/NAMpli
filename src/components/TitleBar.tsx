import './TitleBar.css';

function TitleBar() {
  const handleMinimize = () => {
    // Tauri handles window controls natively
  };

  const handleMaximize = () => {
    // Tauri handles window controls natively
  };

  const handleClose = () => {
    // Tauri handles window close natively
  };

  return (
    <div className="titlebar">
      <div className="titlebar-drag-region">
        <span className="titlebar-text">NAMpli</span>
      </div>
      <div className="titlebar-controls">
        <button className="titlebar-button" onClick={handleMinimize} title="Minimize">
          <svg width="12" height="12" viewBox="0 0 12 12">
            <line x1="1" y1="6" x2="11" y2="6" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
        <button className="titlebar-button" onClick={handleMaximize} title="Maximize">
          <svg width="12" height="12" viewBox="0 0 12 12">
            <rect x="1.5" y="1.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
        <button className="titlebar-button titlebar-close" onClick={handleClose} title="Close">
          <svg width="12" height="12" viewBox="0 0 12 12">
            <line x1="1.5" y1="1.5" x2="10.5" y2="10.5" stroke="currentColor" strokeWidth="1.5" />
            <line x1="10.5" y1="1.5" x2="1.5" y2="10.5" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export default TitleBar;
