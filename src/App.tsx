import { useState } from 'react';
import { useAmpSettings } from './hooks/useAmpSettings';
import { useAudioStatus } from './hooks/useAudioStatus';
import AmpPanel from './components/AmpPanel';
import PowerSwitch from './components/PowerSwitch';
import InputJacks from './components/InputJacks';
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
    setGainLevel,
    setPreampVolume,
    setPresence,
    setBass,
    setMiddle,
    setTreble,
    setMasterVolume,
    togglePower,
    setInputSensitivity,
  } = useAmpSettings();
  const audioStatus = useAudioStatus();

  return (
    <div className="app">
      <SettingsIcon onClick={() => setShowSettings(true)} />
      <TunerIcon onClick={() => setShowTuner(true)} />
      <AudioStatusBar status={audioStatus} />
      <Toast />
      <SettingsPanel open={showSettings} onClose={() => setShowSettings(false)} />
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
          gainLevel={settings.gainLevel}
          preampVolume={settings.preampVolume}
          presence={settings.presence}
          bass={settings.bass}
          middle={settings.middle}
          treble={settings.treble}
          masterVolume={settings.masterVolume}
          powerOn={settings.powerOn}
          onSetGainLevel={setGainLevel}
          onSetPreampVolume={setPreampVolume}
          onSetPresence={setPresence}
          onSetBass={setBass}
          onSetMiddle={setMiddle}
          onSetTreble={setTreble}
          onSetMasterVolume={setMasterVolume}
        />
        <div className="controls-row">
          <InputJacks
            inputSensitivity={settings.inputSensitivity}
            onChange={setInputSensitivity}
            disabled={!settings.powerOn}
          />
          <PowerSwitch powerOn={settings.powerOn} onToggle={togglePower} />
        </div>
      </div>
    </div>
  );
}

export default App;
