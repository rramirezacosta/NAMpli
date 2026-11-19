import { useSyncExternalStore } from "react";
import Knob from "./Knob";
import { getPresetBarSnapshot, subscribePresetBar } from "../presets/presetBarStore";
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

const BYPASS_NAME = "ByPass";
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
  const actions = useSyncExternalStore(subscribePresetBar, getPresetBarSnapshot);
  const slots = actions?.slots ?? [];
  const currentSlot = actions?.currentSlot ?? null;

  // Determine title and subtitle based on mode
  const isUnnamed = actions?.isUnnamed ?? false;
  let title: string;
  let subtitle: string;

  if (isUnnamed) {
    title = "Unnamed";
    const parts: string[] = [];
    if (actions?.unnamedModelName) parts.push(actions.unnamedModelName);
    if (actions?.unnamedIrName) parts.push(`IR: ${actions.unnamedIrName}`);
    subtitle = parts.length ? parts.join(" · ") : BYPASS_SUBTITLE;
  } else {
    title = currentSlot ?? BYPASS_NAME;
    const subtitleParts: string[] = [];
    if (currentSlot) subtitleParts.push(currentSlot);
    if (actions?.modelName) subtitleParts.push(actions.modelName);
    if (actions?.irName) subtitleParts.push(`IR: ${actions.irName}`);
    subtitle = subtitleParts.length ? subtitleParts.join(" · ") : BYPASS_SUBTITLE;
  }

  // Enable cycling when there are multiple slots
  const canCycle = !isUnnamed && slots.length > 0;

  const go = (delta: number) => {
    if (!actions || slots.length === 0) return;
    const found = slots.findIndex((s) => s.slot === currentSlot);
    const from = found >= 0 ? found : 0;
    const next = (from + delta + slots.length) % slots.length;
    actions.loadSlot(slots[next].slot);
  };

  return (
    <div className={`amp-panel ${powerOn ? 'power-on' : 'power-off'}`}>
      {/* Preset select carousel */}
      <div className="panel-header">
        <button
          className="preset-carousel-arrow"
          onClick={() => go(-1)}
          disabled={!canCycle}
          aria-label="Previous preset"
        >
          ‹
        </button>
        <div className="preset-carousel-info">
          <h1 className="panel-title">
            {title}
            {actions?.isDirty ? (
              <span className="preset-carousel-dirty" title="Unsaved changes">
                •
              </span>
            ) : null}
          </h1>
          <p className="panel-subtitle">{subtitle}</p>
        </div>
        {isUnnamed ? (
          <button
            className="save-unnamed-btn"
            onClick={() => actions?.saveUnnamed()}
            title="Save to a preset slot"
          >
            Save preset
          </button>
        ) : (
          <button
            className="preset-carousel-arrow"
            onClick={() => go(1)}
            disabled={!canCycle}
            aria-label="Next preset"
          >
            ›
          </button>
        )}
      </div>
      {/* End of preset select carousel */}

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
          <Knob
            label="Bass"
            value={bass}
            onChange={onSetBass}
            description="Adjusts low frequencies"
          />
        </div>
        <div className="knob-group">
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