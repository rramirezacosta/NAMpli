# Remove Sound Visualization from NAMpli

# Requirements

### Overview
Remove the entire sound-visualization feature: the **Scope** popup (waveform, log-frequency spectrum,
RMS/peak meter and clip LED), the ambient **background visualization** behind the faceplate, their
Settings controls, the frontend polling hook, the Tauri commands, and the DSP-side analyser. After
this change the app has no visualization UI, no visualization IPC, and no FFT work on the audio
thread. Audio processing, presets and the Tuner are untouched.

### Goals
- No visual remnants: no Scope button, no Scope popup, no background canvas, no Settings section.
- No code remnants: no dead hooks, TS types, Rust structs, commands or module declarations.
- No performance remnants: the DSP worker stops allocating/publishing analysis frames, and there is no
  UI polling loop or `visibilitychange` listener for it.
- Keep audio behaviour bit-for-bit identical — only work *after* `out_producer.push_slice` is removed.
- Preserve the uncommitted Tuner work in `src-tauri/src/tuner.rs` and `src/components/Tuner.tsx`
  (do not stash, revert or reformat those files beyond what is already there).

### In Scope
- Frontend: `App.tsx`, `VisualizationIcon.tsx`, `Visualization.tsx/.css`,
  `BackgroundVisualization.tsx/.css`, `SettingsPanel.tsx`, `useVisualization.ts`,
  `useBackgroundVisualizationSettings.ts`, `tauri.ts`, `App.css` comment cleanup.
- Backend: `src-tauri/src/visualizer.rs` (delete), `audio_engine.rs`, `commands.rs`, `lib.rs`.
- Docs: `README.md`, the two obsolete feature plans in `.junie/plans/`.

### Out of Scope
- **Tuner** (`Tuner.tsx`, `TunerIcon.tsx`, `tuner.rs`, `get_tuner`) — a separate pitch-detection
  feature, not sound visualization. The Tuner popup keeps its corner overlay and `useDialogFocus`.
- Audio DSP chain (NAM, IR, EQ, reverb, gate, limiter, ring buffers), presets, power handling,
  drag-and-drop/import, and window/chrome styling.
- No new Cargo dependency removal is needed: `visualizer.rs` contains a hand-written FFT, so
  `Cargo.toml` has no FFT crate to drop.

---

# Implementation Plan

## Step 1 — Frontend UI and state (`src/`)

1. **`src/App.tsx`**
   - Delete imports: `useVisualization`, `useBackgroundVisualizationSettings`,
     `BackgroundVisualization`, `VisualizationIcon`, `Visualization` (lines 7–9, 13, 16).
   - Delete `showVisualization` state, `visualizationPopupRef`, `closeVisualization`,
     `openVisualization`, and the `background` hook call (lines 42, 53, 58, 60–68, 86).
   - Simplify `openTuner` to `setShowTuner(true)`; remove the comment about two analyser popups
     sharing a corner.
   - Delete the `useVisualization(...)` call and the `visualizationFrame` variable (lines 88–92).
   - Delete `useDialogFocus(showVisualization, closeVisualization, visualizationPopupRef)` (line 149).
   - In JSX remove `<BackgroundVisualization …/>` (line 261), `<VisualizationIcon …/>` (line 265),
     the four `background*` props passed to `SettingsPanel` (lines 272–275), and the entire
     `showVisualization && (...)` popup block (lines 296–313).
   - Result: `window-tools` contains only Settings + Tuner; the Tuner popup and focus handling stay.

2. **Delete files**
   - `src/components/Visualization.tsx` + `Visualization.css` (Scope popup + canvas rendering).
   - `src/components/VisualizationIcon.tsx` (Scope toolbar button; no other consumers).
   - `src/components/BackgroundVisualization.tsx` + `BackgroundVisualization.css`
     (ambient canvas + vignette). `.app` already paints `var(--bg-app)`, so no replacement is needed.

3. **`src/components/SettingsPanel.tsx`**
   - Remove the four visualization props from `SettingsPanelProps` and the destructured parameters
     (lines 17–20, 41–44).
   - Delete the `<div className="settings-section">` containing the `Visualization` heading, the
     background checkbox and the intensity slider (lines 272–307). The `Audio` section remains.

4. **Delete hooks**
   - `src/hooks/useVisualization.ts` (33 ms polling loop, visibility listener, enable-flag sync).
   - `src/hooks/useBackgroundVisualizationSettings.ts` (localStorage key `nampli.backgroundVisualization`).
     No other consumers exist. The leftover localStorage entry is inert; do not add a migration to
     delete it (optional hygiene only).
   - `useDialogFocus.ts`, `useAudioStatus.ts`, `useRigState.ts`, `usePresetManager.ts` stay.

5. **`src/tauri.ts`**
   - Delete `VisualizationFrame`, `getVisualization()` and `setVisualizationEnabled()` (lines 114–129).

6. **`src/App.css`** (optional cleanup)
   - Update the stale comment on `.app-content` about painting above the background canvas
     (lines 13–14); keep `position: relative; z-index: 1` — it is harmless and may still matter for
     other overlays. `.visualization-popup` has no CSS rule anywhere, so nothing else to remove.

## Step 2 — Rust backend (`src-tauri/`)

1. **Delete `src-tauri/src/visualizer.rs`** (the `Visualizer`, `VisualizationFrame`, FFT, band
   mapping and its `#[cfg(test)]` module). Nothing else imports it.

2. **`src-tauri/src/lib.rs`**
   - Remove `mod visualizer;` (line 8).
   - Remove `commands::get_visualization` and `commands::set_visualization_enabled` from
     `generate_handler!` (lines 58–59).

3. **`src-tauri/src/commands.rs`**
   - Delete `VisualizationStatus` (lines 325–332) and both commands `get_visualization` /
     `set_visualization_enabled` (lines 334–356). Keep `get_tuner` immediately before them.

4. **`src-tauri/src/audio_engine.rs`** — remove the analyser tap *without* changing audio flow:
   - Line 6: drop `use crate::visualizer::{VisualizationFrame, Visualizer};`.
   - Lines 159–162: delete the `visualization` and `visualization_enabled` struct fields.
   - Lines 181–182: delete their initializers in `AudioEngine::new`.
   - Lines 352–353: delete the stale-frame reset in `start`.
   - Lines 389–390: delete the two `Arc::clone`s moved into the worker.
   - Lines 438–441: delete `let mut visualizer = Visualizer::new(sample_rate);` and
     `let mut was_enabled = false;` (keep `tuner` and all preceding DSP state).
   - Lines 597–616: delete the whole enable-gating / `visualizer.push` / `try_lock` publish block.
     **Keep** `out_producer.push_slice(&buffer[..got]);` at line 595 and the loop closing brace —
     the analysis block is strictly after the output hand-off, so removing it is latency-neutral.
   - Line 722: delete the `*self.visualization.lock() = None;` reset in `stop`.
   - Lines 848–859: delete `visualization()` and `set_visualization_enabled()` methods.
   - Keep all `AtomicBool` imports: stop flags still use them.

## Step 3 — Documentation

1. **`README.md`** — delete the whole `## Sound visualization` section (three paragraphs describing
   Scope, background visualization, and the shared polling/DSP gating). Leave Preset manager and
   Reverb docs intact.
2. **`.junie/plans/`** — delete the now-obsolete design docs `sound-visualization.md` and
   `background-visualization.md`. They describe code that will no longer exist and would otherwise
   mislead future work. Leave unrelated plans (incl. `reverb-knob.md`, `preset-manager.md`) alone.

## Step 4 — Verification

1. `grep -rniE 'visualiz|scope|spectrum|waveform|peakDb|levelDb' src src-tauri README.md .junie/plans`
   → expect **no** visualization-related hits (the words "In Scope"/"Out of Scope" in unrelated
   plan docs and the `scopeguard` entry in `Cargo.lock` are false positives).
2. `npm run build` — TypeScript/Vite build passes with no unused-import or prop errors.
3. `npm run lint` — Oxlint clean.
4. `make rust-check` (or `cd src-tauri && cargo check --features jack`) — no unused import/dead code
   warnings from the removed analyser.
5. `cd src-tauri && cargo test` — visualizer unit tests are gone; tuner/preset tests still pass.
6. `cargo fmt --check` and `cargo clippy --features jack -- -D warnings` on the touched Rust files.
7. Manual smoke test (Tauri dev or browser preview):
   - Title bar shows only Settings and Tuner; no Scope popup can be opened.
   - No ambient visualization behind the faceplate; faceplate remains readable.
   - Settings has only audio device/buffer controls.
   - Tuner popup still opens/closes with Esc/click-outside (its uncommitted changes intact).
   - Audio still plays, power toggle and presets still work.

---

# Risks / Notes

- **Do not touch uncommitted work**: `src-tauri/src/tuner.rs` and `src/components/Tuner.tsx` are
  modified in the working tree (bass-range tuner improvements). None of the visualization edits
  overlap them; leave them exactly as-is.
- **Audio thread safety**: removing lines 597–616 must not swallow `out_producer.push_slice` or alter
  the worker loop; that block is the only visualization-specific code inside the DSP loop.
- **Shared UI affordances**: `.tuner-popup-overlay`/`.tuner-popup` and `.tool-button` styles are used
  by the Tuner too — keep them; only remove the visualization-specific classes/props.
- **Reversibility**: all of this is re-addable from commit `c2976bd` (`feat: add reverb, visualizer,
  and UI improvements`) and the two plan docs if the feature is ever wanted back; delete those docs
  only after the removal is confirmed working.
