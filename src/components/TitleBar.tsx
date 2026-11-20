import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { useWindowControlsSide } from '../hooks/useWindowControlsSide';
import './TitleBar.css';

function TitleBar() {
  const controlsSide = useWindowControlsSide();
  const controlsOnLeft = controlsSide === 'left';

  const handleMinimize = async () => {
    const window = getCurrentWebviewWindow();
    await window.minimize();
  };

  const handleClose = async () => {
    const window = getCurrentWebviewWindow();
    await window.hide();
  };

  const handleDragStart = async () => {
    const window = getCurrentWebviewWindow();
    await window.startDragging();
  };

  const minimizeButton = (
    <button
      key="minimize"
      type="button"
      className="titlebar-button"
      onClick={handleMinimize}
      aria-label="Minimize"
      title="Minimize"
    >
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <line x1="1" y1="6" x2="11" y2="6" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    </button>
  );

  const closeButton = (
    <button
      key="close"
      type="button"
      className="titlebar-button titlebar-close"
      onClick={handleClose}
      aria-label="Close"
      title="Close"
    >
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <line x1="1.5" y1="1.5" x2="10.5" y2="10.5" stroke="currentColor" strokeWidth="1.2" />
        <line x1="10.5" y1="1.5" x2="1.5" y2="10.5" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    </button>
  );

  // Match the OS ordering: close-first when controls are on the left,
  // minimize-first when they are on the right.
  const controls = (
    <div className="titlebar-controls">
      {controlsOnLeft ? [closeButton, minimizeButton] : [minimizeButton, closeButton]}
    </div>
  );

  return (
    <div className={`titlebar${controlsOnLeft ? ' titlebar--controls-left' : ''}`}>
      {controlsOnLeft && controls}
      <div className="titlebar-drag-region" onMouseDown={handleDragStart} />
      <span className="titlebar-brand" aria-hidden="true">NAMpli</span>
      {!controlsOnLeft && controls}
    </div>
  );
}

export default TitleBar;
