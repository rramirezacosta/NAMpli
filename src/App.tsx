import { useState, useEffect, useCallback, useRef } from 'react';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { useRigState } from './hooks/useRigState';
import { usePresetManager } from './hooks/usePresetManager';
import { useAudioStatus } from './hooks/useAudioStatus';
import { useDialogFocus } from './hooks/useDialogFocus';
import AmpPanel from './components/AmpPanel';
import SettingsIcon from './components/SettingsIcon';
import TunerIcon from './components/TunerIcon';
import SettingsPanel from './components/SettingsPanel';
import Tuner from './components/Tuner';
import AudioStatusBar from './components/AudioStatusBar';
import Toast from './components/Toast';
import PresetLibrary from './components/PresetLibrary';
import { importAsset, importPreset, importPresetFromPath, logToTerminal } from './tauri';
import { notifyError, notifySuccess } from './notifications';
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
  // The library is a full-window view, not an overlay.
  const [view, setView] = useState<'amp' | 'library'>('amp');
  const [librarySelection, setLibrarySelection] = useState<string | null>(null);

  // Drag-and-drop state for unnamed mode
  const [dragOver, setDragOver] = useState(false);
  const dragCounter = useRef(0);

  // Confirmation dialog state for NAM files
  const [pendingNam, setPendingNam] = useState<PendingNam | null>(null);

  const tunerPopupRef = useRef<HTMLDivElement>(null);
  const confirmDialogRef = useRef<HTMLDivElement>(null);

  const closeSettings = () => setShowSettings(false);
  const closeTuner = () => setShowTuner(false);
  const openLibrary = () => setView('library');
  const backToAmp = useCallback(() => {
    setView('amp');
    requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>('[data-preset-library-trigger]')?.focus();
    });
  }, []);
  const openTuner = () => setShowTuner(true);

  const rig = useRigState();
  const presetManager = usePresetManager(rig.snapshot(), rig.applySnapshot, rig.clearModelAndIr);
  const { refresh: refreshPresets } = presetManager;
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
      } else if (ext === 'json') {
        if (view !== 'library') {
          notifyError('Open the Library to import a preset file.');
          return;
        }
        await importPresetFromPath(path);
        await refreshPresets();
        notifySuccess('Preset imported');
      } else {
        notifyError(`Unsupported file type: .${ext}`);
      }
    } catch (err) {
      log('[IMPORT] file load FAILED', err);
      notifyError(`Could not load file: ${err}`);
    }
  }, [setIr, view, refreshPresets]);

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
  useDialogFocus(!!pendingNam, handleCancelLoadNam, confirmDialogRef);

  // Key precedence: Esc reverts an audition, otherwise leaves the library view.
  // Enter keeps an audition, otherwise auditions the selected library preset.
  // Dialogs and menus keep their own Escape handling while they are open.
  const { preview: presetPreview, commitPreview, revertPreview, metas, recallAt } = presetManager;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"], [role="menu"]')) return;
      const target = event.target as HTMLElement | null;
      if (event.key === 'Escape') {
        event.preventDefault();
        if (presetPreview) void revertPreview();
        else if (view === 'library') backToAmp();
        return;
      }
      if (event.key !== 'Enter') return;
      // Let a focused control perform its own default action.
      if (
        target &&
        (['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'A'].includes(target.tagName) ||
          target.isContentEditable)
      ) {
        return;
      }
      if (presetPreview) {
        event.preventDefault();
        commitPreview();
      } else if (view === 'library' && librarySelection) {
        const meta = metas.find((item) => item.name === librarySelection);
        if (meta) {
          event.preventDefault();
          void recallAt(meta.bank, meta.slot);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [presetPreview, commitPreview, revertPreview, view, librarySelection, metas, recallAt, backToAmp]);

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
          } else if (ext === 'json') {
            if (view !== 'library') {
              notifyError('Open the Library to import a preset file.');
              return;
            }
            const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
            const json = new TextDecoder().decode(bytes);
            await importPreset(json);
            await refreshPresets();
            notifySuccess('Preset imported');
          } else {
            notifyError(`Unsupported file type: .${ext}`);
          }
        } catch (err) {
          notifyError(`Could not load file: ${err}`);
        }
      };
      reader.readAsDataURL(file);
    }
  }, [setModel, setIr, view, refreshPresets]);

  return (
    <div
      className="app"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div className="window-tools">
        <SettingsIcon onClick={() => setShowSettings(true)} />
        <TunerIcon onClick={openTuner} />
      </div>
      <AudioStatusBar status={audioStatus} />
      <Toast />
      {presetManager.preview && (
        <div className="preview-banner" role="status">
          <span>
            Previewing <strong>{presetManager.preview.activeName ?? 'bypass'}</strong>
            <span className="preview-banner-hint"> · Enter to keep · Esc to revert</span>
          </span>
          <button type="button" onClick={presetManager.commitPreview}>Keep</button>
          <button type="button" onClick={() => void presetManager.revertPreview()}>Revert</button>
        </div>
      )}
      <SettingsPanel open={showSettings} onClose={closeSettings} />
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
      {/* Drop zone overlay */}
      {dragOver && (
        <div className="drop-zone-overlay">
          <div className="drop-zone-content">
            <span className="drop-zone-icon" aria-hidden="true">🎸</span>
            <p>{view === 'library' ? 'Drop a preset JSON, NAM or IR file' : 'Drop NAM or IR file to load'}</p>
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
        {view === 'library' ? (
          <PresetLibrary
            manager={presetManager}
            onBack={backToAmp}
            selected={librarySelection}
            onSelect={setLibrarySelection}
          />
        ) : (
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
            onOpenLibrary={openLibrary}
            onTogglePower={togglePower}
            onSetInputVolume={setInputVolume}
            onSetGate={setGate}
            onSetBass={setBass}
            onSetMiddle={setMiddle}
            onSetTreble={setTreble}
            onSetOutputVolume={setOutputVolume}
            onSetReverb={setReverb}
          />
        )}
      </div>
    </div>
  );
}

export default App;
