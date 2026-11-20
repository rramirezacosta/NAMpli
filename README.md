# NAMpli

NAMpli is a Tauri desktop app for playing NAM guitar amp captures with a cabinet IR.

## Preset manager

The main panel has a DSP-style preset board with two banks (A/B) and four slots each:

- **Click a slot** to recall its knobs, NAM model and IR.
- **Right-click a slot** for Save here, Save As…, Rename… and Delete.
- **Save** writes the current knob state, NAM and IR to the selected slot. A gold dot marks unsaved changes.
- **A/B** compares the current slot with the matching slot in the other bank.
- **Library** opens the preset library, where presets can be recalled, renamed, deleted, exported and imported as JSON.

Dropped `.nam` and `.wav` files are copied into a local asset library under the app's data directory,
so presets keep their model and cabinet after a restart. The app still starts in bypass mode; recall a
preset (or drop a file) to load a model. Noise gate section, cabinet mix, buffer size and audio device
settings are global and are not stored in presets.

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
