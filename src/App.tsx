import { useState, useEffect, useCallback, useRef } from 'react';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { useRigState } from './hooks/useRigState';
import { usePresetManager } from './hooks/usePresetManager';
import { useAudioStatus } from './hooks/useAudioStatus';
import { useDialogFocus } from './hooks/useDialogFocus';
import { useVisualization } from './hooks/useVisualization';
import { useBackgroundVisualizationSettings } from './hooks/useBackgroundVisualizationSettings';
import BackgroundVisualization from './components/BackgroundVisualization';
import AmpPanel from './components/AmpPanel';
import SettingsIcon from './components/SettingsIcon';
import TunerIcon from './components/TunerIcon';
import VisualizationIcon from './components/VisualizationIcon';
import SettingsPanel from './components/SettingsPanel';
import Tuner from './components/Tuner';
import Visualization from './components/Visualization';
import AudioStatusBar from './components/AudioStatusBar';
import Toast from './components/Toast';
import PresetLibrary from './components/PresetLibrary';
import { importAsset, logToTerminal } from './tauri';
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
  const [showVisualization, setShowVisualization] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);

  // Drag-and-drop state for unnamed mode
  const [dragOver, setDragOver] = useState(false);
  const dragCounter = useRef(0);

  // Confirmation dialog state for NAM files
  const [pendingNam, setPendingNam] = useState<PendingNam | null>(null);

  const tunerPopupRef = useRef<HTMLDivElement>(null);
  const visualizationPopupRef = useRef<HTMLDivElement>(null);
  const confirmDialogRef = useRef<HTMLDivElement>(null);

  const closeSettings = () => setShowSettings(false);
  const closeTuner = () => setShowTuner(false);
  const closeVisualization = () => setShowVisualization(false);
  const closeLibrary = () => setShowLibrary(false);
  // The two analyser popups share the same corner, so only one is visible at a time.
  const openTuner = () => {
    setShowVisualization(false);
    setShowTuner(true);
  };
  const openVisualization = () => {
    setShowTuner(false);
    setShowVisualization(true);
  };

  const rig = useRigState();
  const presetManager = usePresetManager(rig.snapshot(), rig.applySnapshot, rig.clearModelAndIr);
  const {
    settings,
    setInputVolume,
    setGate,
    setBass,
    setMiddle,
    setTreble,
    setOutputVolume,
    setReverb,
    togglePower,
    setModel,
    setIr,
  } = rig;
  const audioStatus = useAudioStatus();
  const background = useBackgroundVisualizationSettings();

  // Single polling loop and enable flag for both the background and the popup.
  const visualizationFrame = useVisualization(
    background.enabled || showVisualization,
    settings.powerOn,
  );

  /** Extract the file name from a path reported by Tauri's native drop event. */
  const fileNameFromPath = (path: string) =>
    path.split(/[\\/]/).pop() ?? path;

  /**
   * Process a dropped file path: import a copy into the preset asset library and
   * load it into the audio engine. Tauri's native drag-drop only exposes paths.
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
        const asset = await importAsset('ir', filename, path);
        setIr(asset);
        log('[IMPORT] IR loaded:', asset.name);
      } else {
        notifyError(`Unsupported file type: .${ext}`);
      }
    } catch (err) {
      log('[IMPORT] file load FAILED', err);
      notifyError(`Could not load file: ${err}`);
    }
  }, [setIr]);

  /** Confirm and load the pending NAM file. */
  const handleConfirmLoadNam = async () => {
    const pending = pendingNam;
    if (!pending) return;
    setPendingNam(null);
    try {
      const asset = await importAsset('nam', pending.filename, pending.path);
      setModel(asset);
      log('[IMPORT] NAM loaded:', asset.name);
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

  useDialogFocus(showTuner, closeTuner, tunerPopupRef);
  useDialogFocus(showVisualization, closeVisualization, visualizationPopupRef);
  useDialogFocus(!!pendingNam, handleCancelLoadNam, confirmDialogRef);

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
      // A browser cannot resolve the native path, so send base64 bytes instead.
      const file = files[0];
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = (reader.result as string).split(',')[1];
        const ext = file.name.split('.').pop()?.toLowerCase();
        try {
          if (ext === 'nam') {
            const asset = await importAsset('nam', file.name, undefined, base64);
            setModel(asset);
          } else if (ext === 'wav') {
            const asset = await importAsset('ir', file.name, undefined, base64);
            setIr(asset);
          } else {
            notifyError(`Unsupported file type: .${ext}`);
          }
        } catch (err) {
          notifyError(`Could not load file: ${err}`);
        }
      };
      reader.readAsDataURL(file);
    }
  }, [setModel, setIr]);

  return (
    <div
      className="app"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <BackgroundVisualization frame={visualizationFrame} intensity={background.intensity} />
      <div className="window-tools">
        <SettingsIcon onClick={() => setShowSettings(true)} />
        <TunerIcon onClick={openTuner} />
        <VisualizationIcon onClick={openVisualization} />
      </div>
      <AudioStatusBar status={audioStatus} />
      <Toast />
      <SettingsPanel
        open={showSettings}
        onClose={closeSettings}
        backgroundEnabled={background.enabled}
        backgroundIntensity={background.intensity}
        onSetBackgroundEnabled={background.setEnabled}
        onSetBackgroundIntensity={background.setIntensity}
      />
      <PresetLibrary open={showLibrary} onClose={closeLibrary} manager={presetManager} />
      {showTuner && (
        <div className="tuner-popup-overlay" onClick={closeTuner}>
          <div
            className="tuner-popup"
            ref={tunerPopupRef}
            role="dialog"
            aria-modal="true"
            aria-label="Tuner"
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
          >
            <Tuner powered={settings.powerOn} />
            <button className="tuner-popup-close" onClick={closeTuner}>
              Close
            </button>
          </div>
        </div>
      )}
      {showVisualization && (
        <div className="tuner-popup-overlay" onClick={closeVisualization}>
          <div
            className="tuner-popup visualization-popup"
            ref={visualizationPopupRef}
            role="dialog"
            aria-modal="true"
            aria-label="Scope"
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
          >
            <Visualization frame={visualizationFrame} powered={settings.powerOn} />
            <button className="tuner-popup-close" onClick={closeVisualization}>
              Close
            </button>
          </div>
        </div>
      )}
      {/* Drop zone overlay */}
      {dragOver && (
        <div className="drop-zone-overlay">
          <div className="drop-zone-content">
            <span className="drop-zone-icon" aria-hidden="true">🎸</span>
            <p>Drop NAM or IR file to load</p>
          </div>
        </div>
      )}
      {/* Confirmation dialog for NAM file loading */}
      {pendingNam && (
        <div className="confirm-dialog-overlay" onClick={handleCancelLoadNam}>
          <div
            className="confirm-dialog"
            ref={confirmDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-title"
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="confirm-dialog-title" id="confirm-dialog-title">Load NAM model?</p>
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
          reverb={settings.reverb}
          powerOn={settings.powerOn}
          modelName={rig.model?.name ?? null}
          irName={rig.ir?.name ?? null}
          presetManager={presetManager}
          onOpenLibrary={() => setShowLibrary(true)}
          onTogglePower={togglePower}
          onSetInputVolume={setInputVolume}
          onSetGate={setGate}
          onSetBass={setBass}
          onSetMiddle={setMiddle}
          onSetTreble={setTreble}
          onSetOutputVolume={setOutputVolume}
          onSetReverb={setReverb}
        />
      </div>
    </div>
  );
}

export default App;
