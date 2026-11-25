# NAMpli

NAMpli is a Tauri desktop app for playing NAM guitar amp captures with a cabinet IR.

## Preset manager

The main panel has a DSP-style preset board with four banks (A/B/C/D) and four slots each:

- **Click a slot** to audition its knobs, NAM model and IR immediately. Empty slots are selectable too —
  clicking one auditions bypass (clears the NAM and IR, keeping the knob positions) and makes it the Save
  target. Presets saved with no NAM/IR likewise recall as bypass.
- **Audition** can be undone: a banner shows the preset being previewed. **Esc** (or Revert) restores the
  exact sound you had before, including the loaded model and IR; **Enter** (or Keep) accepts it. Starting a
  second audition does not lose the original sound — Revert always goes back to where you started.
- **Right-click a slot** for Save here, Save As…, Rename… and Delete.
- **Save** writes the current knob state, NAM and IR to the selected slot and ends the audition. A gold dot
  marks unsaved changes: it compares the working sound with the recalled preset (or, for an empty slot, with
  a blank preset). Tiny floating-point drift from the backend knobs does not trigger it.
- **Library** switches to a full-window browser with search, bank filters, sorting and a details panel. The
  currently loaded preset is marked **LOADED** and the one being auditioned is marked **PREVIEW**, so they are
  distinct from the row you merely selected. From there you can audition, rename, move or copy presets between
  slots, export, import and delete them. **Esc** or **← Back to amp** returns to the faceplate (Esc first reverts
  an active audition). Dropping a preset `.json` into the library imports it.

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
