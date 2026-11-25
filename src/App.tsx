import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { useRigState } from './hooks/useRigState';
import { usePresetManager } from './hooks/usePresetManager';
import { useAudioStatus } from './hooks/useAudioStatus';
import { useAssetLibrary } from './hooks/useAssetLibrary';
import { useMeters } from './hooks/useMeters';
import { useDialogFocus } from './hooks/useDialogFocus';
import AmpPanel from './components/AmpPanel';
import LibraryIcon from './components/LibraryIcon';
import SettingsIcon from './components/SettingsIcon';
import TunerIcon from './components/TunerIcon';
import SettingsPanel from './components/SettingsPanel';
import Tuner from './components/Tuner';
import AudioStatusBar from './components/AudioStatusBar';
import Toast from './components/Toast';
import AssetLibrary from './components/AssetLibrary';
import type { AssetMeta, Bank } from './types/preset';
import { importAsset, logToTerminal } from './tauri';
import { notifyError, notifySuccess } from './notifications';
import { fileNameFromPath, isTauri } from './utils/platform';
import './App.css';

/** Pending NAM file waiting for user confirmation */
interface PendingNam {
  filename: string;
  path: string;
}

/** Log to both the browser console and the backend OS terminal. */
function log(...args: unknown[]) {
  console.log(...args);
  void logToTerminal(args.map((arg) => String(arg)).join(' '));
}

function App() {
  const [showSettings, setShowSettings] = useState(false);
  // Library and tuner are full-window views, not overlays.
  const [view, setView] = useState<'amp' | 'library' | 'tuner'>('amp');
  const [assetSelection, setAssetSelection] = useState<string | null>(null);

  // Drag-and-drop state for unnamed mode
  const [dragOver, setDragOver] = useState(false);
  const dragCounter = useRef(0);

  // Confirmation dialog state for NAM files
  const [pendingNam, setPendingNam] = useState<PendingNam | null>(null);

  const confirmDialogRef = useRef<HTMLDivElement>(null);

  const closeSettings = () => setShowSettings(false);
  const openLibrary = () => setView('library');
  const backToAmp = useCallback((from: 'library' | 'tuner' = 'library') => {
    setView('amp');
    requestAnimationFrame(() => {
      const trigger = from === 'tuner' ? '[data-tuner-trigger]' : '[data-library-trigger]';
      document.querySelector<HTMLButtonElement>(trigger)?.focus();
    });
  }, []);
  const openTuner = () => setView('tuner');

  const rig = useRigState();
  const presetManager = usePresetManager(rig.snapshot, rig.applySnapshot, rig.clearModelAndIr);
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
  const meters = useMeters(view === 'amp' && settings.powerOn);
  const assetLibrary = useAssetLibrary(rig);
  const { refresh: refreshAssets } = assetLibrary;

  const handleCleanup = useCallback(() => {
    const keep = [rig.model?.id, rig.ir?.id].filter((id): id is string => !!id);
    const unused = assetLibrary.assets.filter(
      (asset) => asset.usedBy.length === 0 && !keep.includes(asset.id),
    );
    if (unused.length === 0) {
      notifySuccess('Nothing to clean up');
      return;
    }
    if (!window.confirm(`Delete ${unused.length} unused file(s)?\n${unused.map((a) => a.name).join('\n')}`)) {
      return;
    }
    void assetLibrary.cleanup(keep);
  }, [assetLibrary, rig.model, rig.ir]);

  /** Asset previews and preset auditions share one banner, so never overlap them. */
  const handlePreviewAsset = useCallback((asset: AssetMeta) => {
    if (presetManager.preview) presetManager.commitPreview();
    void assetLibrary.previewAsset(asset);
  }, [presetManager, assetLibrary]);

  /** Starting a preset audition commits any pending asset preview first. */
  const presetManagerForAmp = useMemo(() => ({
    ...presetManager,
    recallAt: (bank: Bank, slot: number) => {
      if (assetLibrary.preview) assetLibrary.commitPreview();
      return presetManager.recallAt(bank, slot);
    },
    selectAt: (bank: Bank, slot: number) => {
      if (assetLibrary.preview) assetLibrary.commitPreview();
      presetManager.selectAt(bank, slot);
    },
  }), [presetManager, assetLibrary]);

  /**
   * Process a dropped file path: import a copy into the model/IR asset library and
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
        void refreshAssets();
        log('[IMPORT] IR loaded:', asset.name);
      } else {
        notifyError(`Unsupported file type: .${ext}`);
      }
    } catch (err) {
      log('[IMPORT] file load FAILED', err);
      notifyError(`Could not load file: ${err}`);
    }
  }, [setIr, refreshAssets]);

  /** Confirm and load the pending NAM file. */
  const handleConfirmLoadNam = async () => {
    const pending = pendingNam;
    if (!pending) return;
    setPendingNam(null);
    try {
      const asset = await importAsset('nam', pending.filename, pending.path);
      setModel(asset);
      void refreshAssets();
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

  useDialogFocus(!!pendingNam, handleCancelLoadNam, confirmDialogRef);

  // Key precedence: Esc reverts an audition, otherwise leaves the current view.
  // Enter keeps an audition, otherwise previews the selected asset.
  // Dialogs and menus keep their own Escape handling while they are open.
  const { preview: presetPreview, commitPreview, revertPreview } = presetManager;
  const { preview: assetPreview } = assetLibrary;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"], [role="menu"]')) return;
      const target = event.target as HTMLElement | null;
      if (event.key === 'Escape') {
        event.preventDefault();
        if (presetPreview) void revertPreview();
        else if (assetPreview) void assetLibrary.revertPreview();
        else if (view !== 'amp') backToAmp(view === 'tuner' ? 'tuner' : 'library');
        return;
      }
      // Number keys audition the matching slot in the bank currently on screen.
      // Use the amp wrapper so a pending asset preview is committed first.
      if (
        view === 'amp' &&
        !presetManager.busy &&
        !event.ctrlKey && !event.metaKey && !event.altKey &&
        /^[1-4]$/.test(event.key) &&
        !(
          target &&
          (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)
        )
      ) {
        event.preventDefault();
        const slot = Number(event.key);
        const { bank, metaAt, recallAt, selectAt } = presetManagerForAmp;
        if (metaAt(bank, slot)) void recallAt(bank, slot);
        else selectAt(bank, slot);
        return;
      }
      if (event.key !== 'Enter') return;
      // Keep/revert always wins: after clicking a slot the button keeps focus,
      // so a focused-control bail-out here would re-recall instead of keeping.
      if (presetPreview) {
        event.preventDefault();
        commitPreview();
        return;
      }
      if (assetPreview) {
        event.preventDefault();
        assetLibrary.commitPreview();
        return;
      }
      // Let a focused control perform its own default action.
      if (
        target &&
        (['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'A'].includes(target.tagName) ||
          target.isContentEditable)
      ) {
        return;
      }
      if (view === 'library' && assetSelection) {
        const asset = assetLibrary.assets.find((item) => item.id === assetSelection);
        if (asset) {
          event.preventDefault();
          handlePreviewAsset(asset);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    presetPreview, commitPreview, revertPreview, assetPreview, view, assetSelection,
    assetLibrary, handlePreviewAsset, backToAmp, presetManager.busy, presetManagerForAmp,
  ]);

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
            void refreshAssets();
          } else if (ext === 'wav') {
            const asset = await importAsset('ir', file.name, undefined, base64);
            setIr(asset);
            void refreshAssets();
          } else {
            notifyError(`Unsupported file type: .${ext}`);
          }
        } catch (err) {
          notifyError(`Could not load file: ${err}`);
        }
      };
      reader.readAsDataURL(file);
    }
  }, [setModel, setIr, refreshAssets]);

  return (
    <div
      className="app"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Full-window views own the whole faceplate; the floating tools would sit
          on top of their headers, so only show them on the amp view. */}
      {view === 'amp' && (
        <div className="window-tools">
          <TunerIcon onClick={openTuner} />
          <LibraryIcon onClick={openLibrary} />
          <SettingsIcon onClick={() => setShowSettings(true)} />
        </div>
      )}
      <AudioStatusBar status={audioStatus} />
      <Toast />
      {(presetManager.preview || assetPreview) && (
        <div className="preview-banner" role="status">
          <span>
            Previewing <strong>{presetManager.preview?.activeName ?? assetLibrary.previewName ?? 'bypass'}</strong>
            <span className="preview-banner-hint"> · Enter to keep · Esc to revert</span>
          </span>
          <button type="button" onClick={presetManager.preview ? presetManager.commitPreview : assetLibrary.commitPreview}>
            Keep
          </button>
          <button type="button" onClick={() => {
            if (presetManager.preview) void presetManager.revertPreview();
            else void assetLibrary.revertPreview();
          }}>
            Revert
          </button>
        </div>
      )}
      <SettingsPanel open={showSettings} onClose={closeSettings} />
      {/* Drop zone overlay */}
      {dragOver && (
        <div className="drop-zone-overlay">
          <div className="drop-zone-content">
            <span className="drop-zone-icon" aria-hidden="true">🎸</span>
            <p>Drop a NAM model or IR file</p>
          </div>
        </div>
      )}
      {/* Confirmation dialog for NAM file loading */}
      {pendingNam && (
        <div className="confirm-dialog-overlay overlay" onClick={handleCancelLoadNam}>
          <div
            className="confirm-dialog card"
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
              <button className="confirm-dialog-btn btn cancel" onClick={handleCancelLoadNam}>
                Cancel
              </button>
              <button className="confirm-dialog-btn btn btn-primary load" onClick={handleConfirmLoadNam}>
                Load
              </button>
            </div>
          </div>
        </div>
      )}
      <div className={`app-content ${view === 'amp' ? '' : 'app-content-full-view'}`}>
        {view === 'tuner' ? (
          <Tuner powered={settings.powerOn} onBack={() => backToAmp('tuner')} />
        ) : view === 'library' ? (
          <AssetLibrary
            assets={assetLibrary.assets}
            model={rig.model}
            ir={rig.ir}
            previewId={assetLibrary.previewId}
            busy={assetLibrary.busy}
            selected={assetSelection}
            onSelect={setAssetSelection}
            onBack={() => backToAmp('library')}
            onPreview={handlePreviewAsset}
            onLoad={(asset) => void assetLibrary.load(asset)}
            onStore={(kind, filename, path, data) => void assetLibrary.store(kind, filename, path, data)}
            onExport={(asset, path) => void assetLibrary.exportAsset(asset, path)}
            onDelete={(asset, force) => void assetLibrary.remove(asset, force)}
            onRename={(asset, newName) => assetLibrary.rename(asset, newName)}
            onCleanup={handleCleanup}
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
            previewing={!!presetManager.preview || !!assetPreview}
            modelName={rig.model?.name ?? null}
            irName={rig.ir?.name ?? null}
            meters={meters}
            presetManager={presetManagerForAmp}
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
