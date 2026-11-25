# Remove preset import/export

> **Status: implemented.** `tsc --noEmit`, `npm run lint` (one pre-existing unrelated warning at
> `SettingsPanel.tsx:60`), `npm run build` and `cargo check` pass. `cargo test --lib`: 33 pass, 1 fails
> (`model_manager::tests::loads_real_nam_and_processes_audio` — needs the absent `nams/JCM800 Hi P6 B8
> M4 T7 G2.nam` fixture, unrelated to this change). Manual native-window QA is still pending.
> Line numbers below are as of writing and may drift slightly; `README.md` was rewritten during
> implementation and already contained no preset import/export claims, so no README edit was needed.

# Context

The app has **two unrelated import/export features**:

| Feature | Files | Commands | Status in this plan |
|---|---|---|---|
| Preset JSON import/export | slot menu, `.json` drag-and-drop | `import_preset`, `import_preset_from_path`, `export_preset`, `export_preset_to_path` | **remove entirely** |
| Model & IR asset import/export | `AssetLibrary`, `PresetEditor`, `.nam`/`.wav` drops | `import_asset`, `store_asset_file`, `export_asset_to_path` | **keep unchanged** |

Preset import/export lets a user move stored rigs between installs via `.json` files, but it duplicates
the on-disk preset format, requires four backend commands, and adds a `.json` branch to both drop paths.
This plan removes the feature end-to-end: commands, TS bridges, UI, drop handling, hints and docs.

# Goals / Non-goals

**Goals**
1. No UI path to import or export a preset JSON: slot-menu items and `.json` drop branches are gone.
2. The four Tauri commands and their TS wrappers are deleted; no dead bridges remain.
3. All hints and docs stop advertising preset JSON import/export.
4. Preset save/recall/rename/delete/move, and the entire NAM/IR asset library, keep working.

**Non-goals**
- Removing the on-disk preset JSON format, `PresetPayload`/`PresetMeta`, or `parse_preset_json` — these
  are the app's own storage and are shared by save/load/move.
- Removing asset-library import/export (`.nam`/`.wav`) or its dialog/`notifySuccess` usage.
- Migrating or deleting existing preset files — stored presets remain fully usable.
- Adding replacement features (e.g. portable bundles, clone/duplicate commands).

# Technical design

### 1. Backend — `src-tauri/src/`

- **`src-tauri/src/commands.rs:852-897`** — delete all four commands:
  `export_preset` (852-856), `export_preset_to_path` (858-863), `import_preset` (865-891),
  `import_preset_from_path` (893-897).
  - Keep everything else: `read_preset` (628-632), `write_preset` (634-672, also used by `save_preset`),
    `parse_preset_json` (598-626, used by `move_preset` and tests), `meta_for` (674-684),
    `load_index` (525-532), `sanitize_preset_name` (513-519), `preset_path` (590-596), and the whole
    asset-library section (899-1347). None of these become dead after the deletion.
  - No Rust unit test calls the four commands (`commands.rs` test module starts at 1457), so no test
    deletions are needed; keep the 8 existing tests.
- **`src-tauri/src/lib.rs:69-72`** — remove the four `commands::*` registrations from
  `generate_handler!`. Keep `tauri_plugin_dialog::init()` (line 18) and `dialog:default` capability
  (`capabilities/default.json:14`) — the asset library and `PresetEditor` still need file dialogs.

### 2. TS bridge — `src/tauri.ts:270-284`

Delete all four wrappers: `exportPreset`, `exportPresetToPath`, `importPreset`,
`importPresetFromPath`. `exportPreset` has no callers at all; the other three are removed in the
steps below. Keep `PresetMeta`/`PresetPayload` type imports (used by `listPresets`, `savePreset`,
`loadPreset`, `getPreset`) and all `importAsset`/`exportAssetToPath`/`storeAsset` wrappers.

### 3. Slot menu — `src/components/PresetBar.tsx`

- Delete `handleImportPreset` (133-147) and `handleExportPreset` (149-162).
- Delete the menu items: "Import preset…" (245-247) and "Export…" (273-275). The remaining items are
  Save here, Save As…, Edit…, Rename…, Delete.
- Delete the now-unused imports: `@tauri-apps/plugin-dialog` (line 3), `exportPresetToPath /
  importPresetFromPath` from `../tauri` (line 7), and `notifyError / notifySuccess` from
  `../notifications` (line 8). Grep confirms these symbols are used **only** by the code above in
  this file (the dialog plugin remains in use by `PresetEditor.tsx` and `AssetLibrary.tsx`).
- Keep the menu keyboard/escape logic (52-115) and all CSS (`.preset-menu*`, `.preset-slot-menu-trigger`)
  — they serve the remaining menu items. No CSS deletion is needed.

### 4. Drag-and-drop — `src/App.tsx`

- **Line 19:** narrow the import to `importAsset, logToTerminal` (drop `importPreset`,
  `importPresetFromPath`).
- **Line 64:** delete `const { refresh: refreshPresets } = presetManager;` — used only by the two
  `.json` branches and the dependency arrays at 146 and 334.
- **Native path `handleDroppedPath` (121-146):** delete the `else if (ext === 'json') { … }` block
  (135-138). Keep `.nam` (127-129), `.wav` (130-134), the `Unsupported file type` fallback (139-141),
  and the catch block (142-145). Remove `refreshPresets` from the deps (146).
  - Result: dropping a `.json` now produces `Unsupported file type: .json` via the existing fallback.
- **Browser fallback `handleDrop` (294-334):** delete the `else if (ext === 'json') { … }` block
  (319-324), including the `atob`/`TextDecoder` conversion. Keep the FileReader/base64 path for
  `.nam`/`.wav` and the same fallback. Remove `refreshPresets` from the deps (334).
- **Keep intact:** the native `onDragDropEvent` listener (227-266), browser drag callbacks (268-292),
  `pendingNam` state/confirm dialog (47, 148-173, 383-409), and `useAssetLibrary` refresh wiring.
- Fix the stale comment at 117-120 ("preset asset library" → "model/IR asset library") while here.

### 5. User-facing text

- **`src/App.tsx:378`** — drop-zone overlay: `Drop a NAM model, IR or preset JSON file` →
  `Drop a NAM model or IR file`.
- **`src/components/AmpPanel.tsx:178`** — footer hint: `Drop .nam / .wav / .json to load · Library for
  stored files` → `Drop .nam / .wav to load · Library for stored files`.
- Keep the NAM confirmation dialog text, asset-library strings, and `Unsupported file type: .${ext}`
  (now also shown for `.json`).

### 6. Docs

- **`README.md:15`** — remove "Import preset…" and "Export…" from the slot-menu list; keep the
  `Edit…` paragraph intact.
- **`README.md:21-22`** — rewrite to drop "dropping a preset `.json` anywhere imports it"; e.g.
  "Presets are managed from the faceplate board and its slot menu."
- **`README.md:31-46`** — leave untouched (asset import/export still documented).
- Historical plans describe the old feature and can receive a short status note rather than being
  rewritten: `.junie/plans/asset-library.md` (9, 101-104, 162-165, 200),
  `full-window-library.md` (27, 30, 86-88), `improve-preset-management.md` (61-75, 99-121, 188-190),
  `preset-manager.md` (178-180, 201, 212), `ui-polish.md` (116, 150-151, 235-236).
  `reverb-knob.md` references "preset JSON" as the storage format only — leave it alone.
- **`RELEASE_NOTES.md:42,45-46`** still describes the v0.1.0 release, where the feature did ship; left
  as a historical snapshot rather than rewritten. Add an explicit removal note when a new release is cut.

# Risks / things to watch

- **Don't delete shared helpers.** `read_preset`, `write_preset`, `parse_preset_json`, `meta_for`,
  `PresetPayload`, `PresetMeta` all have other callers. Only the four command functions are removable.
- **Don't drop the dialog plugin/capability.** Asset-library "Import…"/"Export…" and `PresetEditor`'s
  "Import…" still call `@tauri-apps/plugin-dialog`.
- **TypeScript strictness** (`tsconfig.app.json:20-21`, `noUnusedLocals`/`noUnusedParameters`) will
  catch any leftover import (`refreshPresets`, dialog imports, notify imports) — rely on `tsc`.
- **Existing users' preset files are unaffected**: load/save still read and write the same JSON.

# Verification

No frontend test runner exists (`package.json:6-12`). Verify with:

1. `npx tsc --noEmit -p tsconfig.app.json` — catches stale imports/props.
2. `npm run lint` — note the pre-existing unrelated warning at `SettingsPanel.tsx:60`.
3. `npm run build`.
4. `cd src-tauri && cargo check` (or `cargo test`) — catches dangling command registrations.
5. Manual QA at 1200×650:
   - Slot `⋯` menu shows Save here / Save As… / Edit… / Rename… / Delete only; each still works.
   - Dropping a preset `.json` (native and browser/dev-server) shows "Unsupported file type: .json"
     and no state change.
   - Dropping `.nam`/`.wav` still imports/loads, NAM confirm dialog still appears.
   - Library Import…/Export… and `PresetEditor` Import… still work.
   - Save/recall/rename/delete/move presets still work after restart.

# Delivery steps

- [x] **Step 1 — Backend.** Delete the four commands in `commands.rs` and their registrations in
      `lib.rs`. `cargo check` passes.
- [x] **Step 2 — Bridge.** Delete the four wrappers in `tauri.ts`. `npx tsc --noEmit` passes.
- [x] **Step 3 — UI.** Remove both handlers and menu items from `PresetBar.tsx` plus its three unused
      imports; remove the `.json` branches and `refreshPresets` from `App.tsx`.
- [x] **Step 4 — Text.** Update drop-zone overlay and footer hint; `.json` now hits the existing
      "Unsupported file type" fallback.
- [x] **Step 5 — Verify.** `tsc`, `npm run lint` (one pre-existing warning), `npm run build`,
      `cargo check` pass. `cargo test --lib`: 33 pass, 1 pre-existing fixture-dependent failure.
      Manual native-window QA is pending.
- [x] **Step 6 — Docs.** No README edit needed — the current README was rewritten during
      implementation and no longer documents preset import/export. Historical plans were left as
      records of past work; this plan carries the status note.

# Open decisions

- Keep `export_preset` (returns a JSON string, currently no UI caller) as a dev/debug command, or
  remove it with the rest? Recommendation: remove — "remove all import/export" implies no dead surface.
- Behaviour for dropped `.json`: default `Unsupported file type: .json` (recommended) vs a dedicated
  "Preset import is no longer supported" toast. Recommendation: keep the generic message; no new string.
- Historical plans: add a one-line "superseded" note (recommended) versus leave untouched as records of
  past implementation.
