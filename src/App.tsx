import { useState } from 'react';
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
import './App.css';

function App() {
  const [showSettings, setShowSettings] = useState(false);
  const [showTuner, setShowTuner] = useState(false);
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
    <div className="app">
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
