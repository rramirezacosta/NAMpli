import { useState, useEffect, useCallback, useRef } from 'react';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { useAmpSettings } from './hooks/useAmpSettings';
import { useAudioStatus } from './hooks/useAudioStatus';
import TitleBar from './components/TitleBar';
import AmpPanel from './components/AmpPanel';
import PowerSwitch from './components/PowerSwitch';
import SettingsIcon from './components/SettingsIcon';
import TunerIcon from './components/TunerIcon';
import SettingsPanel from './components/SettingsPanel';
import Tuner from './components/Tuner';
import AudioStatusBar from './components/AudioStatusBar';
import Toast from './components/Toast';
import {
  loadNamFromBytes,
  loadNamFromPath,
  loadIr,
  saveIrFile,
  logToTerminal,
} from './tauri';
import { notifyError } from './notifications';
import './App.css';

/** Pending NAM file waiting for user confirmation */
interface PendingNam {
  filename: string;
  path: string;
}

/** True when running inside the Tauri webview (native drag-drop events available). */
const isTauri = () => '__TAURI_INTERNALS__' in window;

/** Log to both the browser console and the backend OS terminal. */
function log(...args: unknown[]) {
  console.log(...args);
  void logToTerminal(args.map((arg) => String(arg)).join(' '));
}

function App() {
  const [showSettings, setShowSettings] = useState(false);
  const [showTuner, setShowTuner] = useState(false);

  // Drag-and-drop state for unnamed mode
  const [dragOver, setDragOver] = useState(false);
  const dragCounter = useRef(0);

  // Confirmation dialog state for NAM files
  const [pendingNam, setPendingNam] = useState<PendingNam | null>(null);

  /** Extract the file name from a path reported by Tauri's native drop event. */
  const fileNameFromPath = (path: string) =>
    path.split(/[\\/]/).pop() ?? path;

  /**
   * Process a dropped file path: load it into the audio engine and notify the UI.
   * Tauri's native drag-drop event only exposes paths, never File objects.
   */
  const handleDroppedPath = useCallback(async (path: string) => {
    const filename = fileNameFromPath(path);
    const ext = filename.split('.').pop()?.toLowerCase();
    log('[IMPORT] dropped file:', filename, 'ext:', ext);

    try {
      if (ext === 'nam') {
        // Show a confirmation dialog before replacing the current model.
        setPendingNam({ filename, path });
      } else if (ext === 'wav') {
        // load_ir reads and installs the IR in the backend (not just a UI label).
        const irName = await loadIr(path);
        log('[IMPORT] IR loaded:', irName);
        window.dispatchEvent(new CustomEvent('load-unnamed-ir', { detail: path }));
      } else {
        notifyError(`Unsupported file type: .${ext}`);
      }
    } catch (err) {
      log('[IMPORT] file load FAILED', err);
      notifyError(`Could not load file: ${err}`);
    }
  }, []);

  /** Confirm and load the pending NAM file. */
  const handleConfirmLoadNam = async () => {
    const pending = pendingNam;
    if (!pending) return;
    setPendingNam(null);
    try {
      const modelName = await loadNamFromPath(pending.path);
      log('[IMPORT] NAM loaded:', modelName);
      window.dispatchEvent(new CustomEvent('load-unnamed-nam', { detail: modelName }));
    } catch (err) {
      log('[IMPORT] NAM load FAILED', err);
      notifyError(`Could not load NAM file: ${err}`);
    }
  };

  /** Cancel loading the pending NAM file. */
  const handleCancelLoadNam = () => {
    const filename = pendingNam?.filename;
    setPendingNam(null);
    if (filename) {
      log('[IMPORT] NAM load cancelled:', filename);
    }
  };

  // Native drag-and-drop: browsers' onDrop does not fire for OS file drops in
  // the Tauri webview, so listen to the webview event which carries file paths.
  useEffect(() => {
    if (!isTauri()) return;

    let cancelled = false;
    let unlisten: (() => void) | undefined;

    getCurrentWebviewWindow()
      .onDragDropEvent((event) => {
        switch (event.payload.type) {
          case 'enter':
          case 'over':
            setDragOver(true);
            break;
          case 'leave':
            setDragOver(false);
            break;
          case 'drop':
            setDragOver(false);
            dragCounter.current = 0;
            if (event.payload.paths.length > 0) {
              void handleDroppedPath(event.payload.paths[0]);
            }
            break;
        }
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch((err) => {
        log('[DROP] Could not register native drag-drop listener:', err);
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [handleDroppedPath]);

  // Fallback for a plain browser (e.g. `npm run dev` / `npm run preview`),
  // where native Tauri events do not exist and HTML5 drop events do work.
  const handleDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (isTauri()) return;
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (isTauri()) return;
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setDragOver(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (isTauri()) return;
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (isTauri()) return;
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setDragOver(false);

    const files = e.dataTransfer.files;
    log('[DROP] handleDrop: received', files.length, 'file(s)');
    if (files.length > 0) {
      // In a browser we cannot get file contents from the native path, so use
      // the backend's byte-based loader for this fallback path.
      const file = files[0];
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = (reader.result as string).split(',')[1];
        const ext = file.name.split('.').pop()?.toLowerCase();
        try {
          if (ext === 'nam') {
            const modelName = await loadNamFromBytes(file.name, base64);
            window.dispatchEvent(new CustomEvent('load-unnamed-nam', { detail: modelName }));
          } else if (ext === 'wav') {
            const path = await saveIrFile(file.name, base64);
            window.dispatchEvent(new CustomEvent('load-unnamed-ir', { detail: path }));
          } else {
            notifyError(`Unsupported file type: .${ext}`);
          }
        } catch (err) {
          notifyError(`Could not load file: ${err}`);
        }
      };
      reader.readAsDataURL(file);
    }
  }, []);

  const {
    settings,
    setInputVolume,
    setGate,
    setBass,
    setMiddle,
    setTreble,
    setOutputVolume,
    togglePower,
  } = useAmpSettings();
  const audioStatus = useAudioStatus();

  return (
    <div
      className="app"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <TitleBar />
      <SettingsIcon onClick={() => setShowSettings(true)} />
      <TunerIcon onClick={() => setShowTuner(true)} />
      <AudioStatusBar status={audioStatus} />
      <Toast />
      <SettingsPanel
        open={showSettings}
        onClose={() => setShowSettings(false)}
        settings={settings}
        onSetInputVolume={setInputVolume}
        onSetGate={setGate}
        onSetBass={setBass}
        onSetMiddle={setMiddle}
        onSetTreble={setTreble}
        onSetOutputVolume={setOutputVolume}
      />
      {showTuner && (
        <div className="tuner-popup-overlay" onClick={() => setShowTuner(false)}>
          <div className="tuner-popup" onClick={(e) => e.stopPropagation()}>
            <Tuner powered={settings.powerOn} />
            <button className="tuner-popup-close" onClick={() => setShowTuner(false)}>
              Close
            </button>
          </div>
        </div>
      )}
      {/* Drop zone overlay */}
      {dragOver && (
        <div className="drop-zone-overlay">
          <div className="drop-zone-content">
            <span className="drop-zone-icon">🎸</span>
            <p>Drop NAM or IR file to load</p>
          </div>
        </div>
      )}
      {/* Confirmation dialog for NAM file loading */}
      {pendingNam && (
        <div className="confirm-dialog-overlay" onClick={handleCancelLoadNam}>
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <p className="confirm-dialog-title">Load NAM model?</p>
            <p className="confirm-dialog-message">
              This will replace the currently loaded model.
            </p>
            <p className="confirm-dialog-filename">{pendingNam.filename}</p>
            <div className="confirm-dialog-buttons">
              <button className="confirm-dialog-btn cancel" onClick={handleCancelLoadNam}>
                Cancel
              </button>
              <button className="confirm-dialog-btn load" onClick={handleConfirmLoadNam}>
                Load
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="app-content">
        <AmpPanel
          inputVolume={settings.inputVolume}
          gate={settings.gate}
          bass={settings.bass}
          middle={settings.middle}
          treble={settings.treble}
          outputVolume={settings.outputVolume}
          powerOn={settings.powerOn}
          onSetInputVolume={setInputVolume}
          onSetGate={setGate}
          onSetBass={setBass}
          onSetMiddle={setMiddle}
          onSetTreble={setTreble}
          onSetOutputVolume={setOutputVolume}
        />
        <div className="controls-row">
          <PowerSwitch powerOn={settings.powerOn} onToggle={togglePower} />
        </div>
      </div>
    </div>
  );
}

export default App;
