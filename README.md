# NAMpli

NAMpli is a Tauri desktop app for playing NAM guitar amp captures with a cabinet IR.

## Preset manager

The main panel has a DSP-style preset board with two banks (A/B) and four slots each:

- **Click a slot** to recall its knobs, NAM model and IR. Empty slots are selectable too — clicking one
  loads bypass (clears the NAM and IR, keeping the knob positions) and makes it the Save target. Presets
  saved with no NAM/IR likewise recall as bypass.
- **Right-click a slot** for Save here, Save As…, Rename… and Delete.
- **Save** writes the current knob state, NAM and IR to the selected slot. A gold dot marks unsaved changes.
- **A/B** compares the current slot with the matching slot in the other bank.
- **Library** opens the preset library, where presets can be recalled, renamed, deleted, exported and imported as JSON.

Dropped `.nam` and `.wav` files are copied into a local asset library under the app's data directory,
so presets keep their model and cabinet after a restart. The app still starts in bypass mode; recall a
preset (or drop a file) to load a model. Models and cabinet IRs are loaded by dropping files or by
recalling a preset; the options dialog only holds audio device and buffer size settings. Those settings
are global and are not stored in presets.

## Reverb

The **Reverb** knob on the output section adds an algorithmic room reverb (0 = off, 10 = maximum wet
mix). It starts off, changes take effect immediately while playing, and its value is saved with each
preset. Older presets without a reverb value recall with the effect off. Room size and damping are
fixed; no external IR file is needed.

## Sound visualization

The **Scope** button in the title bar opens a live display of the amp's output: an oscilloscope
waveform, a log-frequency spectrum, and an RMS/peak level meter with a clip indicator. It reads the
signal after the whole DSP chain, so EQ, reverb and gain changes are visible as you play.

While the amp is powered on, the same signal also drives an ambient **background visualization**:
a muted spectrum and waveform behind the faceplate. It is on by default; **Settings → Visualization**
has a toggle to switch it off and an intensity slider. The background and the Scope popup share one
polling loop, so opening the popup does not start a second one.

Both views are read-only and do not change the sound or add audio latency. Analysis runs on the
existing DSP thread after the output buffer has been handed off, and it is switched off entirely
while nothing is displayed, the window is hidden, or the amp is powered off. The Tuner and Scope
popups share the same corner, so opening one closes the other.

# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.
