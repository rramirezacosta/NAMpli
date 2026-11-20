import { useState, useEffect } from "react";
import Knob from "./Knob";
import "./AmpPanel.css";

interface AmpPanelProps {
  inputVolume: number;
  gate: number;
  bass: number;
  middle: number;
  treble: number;
  outputVolume: number;
  powerOn: boolean;
  onSetInputVolume: (v: number) => void;
  onSetGate: (v: number) => void;
  onSetBass: (v: number) => void;
  onSetMiddle: (v: number) => void;
  onSetTreble: (v: number) => void;
  onSetOutputVolume: (v: number) => void;
}

const BYPASS_SUBTITLE = "No NAM or IR loaded";

export default function AmpPanel({
  inputVolume,
  gate,
  bass,
  middle,
  treble,
  outputVolume,
  powerOn,
  onSetInputVolume,
  onSetGate,
  onSetBass,
  onSetMiddle,
  onSetTreble,
  onSetOutputVolume,
}: AmpPanelProps) {
  const [modelName, setModelName] = useState<string | null>(null);
  const [irName, setIrName] = useState<string | null>(null);

  useEffect(() => {
    const handleNamEvent = (e: Event) => {
      // Detail is now the model name directly (e.g. "MyAmp.nam")
      const name = ((e as CustomEvent).detail as string).replace(/\.nam$/i, "");
      setModelName(name);
    };
    const handleIrEvent = (e: Event) => {
      const path = (e as CustomEvent).detail as string;
      const fileName = path.split("/").pop() ?? path.split("\\").pop() ?? path;
      const name = fileName.replace(/\.wav$/i, "");
      setIrName(name);
    };
    window.addEventListener("load-unnamed-nam", handleNamEvent);
    window.addEventListener("load-unnamed-ir", handleIrEvent);
    return () => {
      window.removeEventListener("load-unnamed-nam", handleNamEvent);
      window.removeEventListener("load-unnamed-ir", handleIrEvent);
    };
  }, []);

  // Build subtitle from loaded model/IR names
  const subtitleParts: string[] = [];
  if (modelName) subtitleParts.push(modelName);
  if (irName) subtitleParts.push(`IR: ${irName}`);
  const subtitle = subtitleParts.length
    ? subtitleParts.join(" · ")
    : BYPASS_SUBTITLE;

  return (
    <div className={`amp-panel ${powerOn ? "power-on" : "power-off"}`}>
      <div className="panel-header">
        <div className="panel-title-group">
          <h1 className="panel-title">NAMpli</h1>
          <p className="panel-subtitle">{subtitle}</p>
        </div>
      </div>

      <div className="knob-row">
        <div className="knob-group">
          <Knob
            label="Input"
            value={inputVolume}
            onChange={onSetInputVolume}
            description="Input trim: pushes the guitar harder (or softer) into the model. 5 = unity."
          />
          <Knob
            label="Gate"
            value={gate}
            onChange={onSetGate}
            description="Noise gate threshold. 0 = off."
          />
        </div>
        <div className="knob-group">
          <Knob
            label="Bass"
            value={bass}
            onChange={onSetBass}
            description="Adjusts low frequencies"
          />
          <Knob
            label="Middle"
            value={middle}
            onChange={onSetMiddle}
            description="Adjusts midrange frequencies"
          />
          <Knob
            label="Treble"
            value={treble}
            onChange={onSetTreble}
            description="Adjusts high frequencies"
          />
        </div>
        <div className="knob-group">
          <Knob
            label="Output"
            value={outputVolume}
            onChange={onSetOutputVolume}
            description="Controls overall output volume"
          />
        </div>
      </div>
    </div>
  );
}
