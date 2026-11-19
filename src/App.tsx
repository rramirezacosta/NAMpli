import { useState, useCallback, useRef } from 'react';
import { useAmpSettings } from './hooks/useAmpSettings';
import { useAudioStatus } from './hooks/useAudioStatus';
import AmpPanel from './components/AmpPanel';
import PowerSwitch from './components/PowerSwitch';
import SettingsIcon from './components/SettingsIcon';
import TunerIcon from './components/TunerIcon';
import SettingsPanel from './components/SettingsPanel';
import Tuner from './components/Tuner';
import AudioStatusBar from './components/AudioStatusBar';
import Toast from './components/Toast';
import { saveNamFileUnnamed, saveIrFile, logToTerminal } from './tauri';
import { notifyError } from './notifications';
import './App.css';

/** Log to both the browser console and the backend OS terminal. */
function log(msg: string) {
  console.log(msg);
  void logToTerminal(msg);
}

function App() {
  const [showSettings, setShowSettings] = useState(false);
  const [showTuner, setShowTuner] = useState(false);

  // Drag-and-drop state for unnamed mode
  const [dragOver, setDragOver] = useState(false);
  const dragCounter = useRef(0);

  /** Handle saving from unnamed mode: open settings */
  const handleSaveUnnamedFromHeader = () => {
    setShowSettings(true);
  };

  /** Read a File object as base64 string */
  const readFileAsBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  /** Process a dropped file: save it and load into audio engine */
  const handleDroppedFile = async (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    log('[IMPORT] handleDroppedFile:', file.name, 'ext:', ext);

    try {
      const base64 = await readFileAsBase64(file);

      if (ext === 'nam') {
        const path = await saveNamFileUnnamed(file.name, base64);
        log('[IMPORT] handleDroppedFile: NAM saved to', path);
        window.dispatchEvent(new CustomEvent('load-unnamed-nam', { detail: path }));
      } else if (ext === 'wav') {
        const path = await saveIrFile(file.name, base64);
        log('[IMPORT] handleDroppedFile: IR saved to', path);
        window.dispatchEvent(new CustomEvent('load-unnamed-ir', { detail: path }));
      } else {
        log('[IMPORT] handleDroppedFile: unsupported extension', ext);
        notifyError(`Unsupported file type: .${ext}`);
      }
    } catch (err) {
      log('[IMPORT] handleDroppedFile: FAILED', err);
      notifyError(`Could not load file: ${err}`);
    }
  };

  // Drag-and-drop handlers on the root app div
  const handleDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setDragOver(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setDragOver(false);

    const files = e.dataTransfer.files;
    log('[DROP] handleDrop: received', files.length, 'file(s)', files.length > 0 ? files[0].name : '');
    if (files.length > 0) {
      void handleDroppedFile(files[0]);
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
      <SettingsIcon onClick={() => setShowSettings(true)} />
      <TunerIcon onClick={() => setShowTuner(true)} />
      <AudioStatusBar status={audioStatus} />
      <Toast />
      <SettingsPanel
        open={showSettings}
        onClose={() => setShowSettings(false)}
        onSaveUnnamed={handleSaveUnnamedFromHeader}
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
