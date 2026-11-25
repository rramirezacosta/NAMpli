# Refocus the Library on NAM / IR files

# Requirements

### Overview
Turn the full-window **Library** view from a preset browser into an **asset library** for NAM models
and cabinet IRs: browse, search, filter, sort, import, load/preview, export and manage the files the
app has stored locally. The four-by-four preset board and its slot actions stay on the amp faceplate
(`PresetBar` / `PresetEditor` / audition banner); preset JSON management moves out of the Library
view so nothing preset-related remains there.

**Assumption:** the Library becomes asset-only, not a second tab that also lists presets. If both
lists are wanted later, add a separate "Presets" tab rather than mixing them back into this view.

### Goals
- Library lists the stored NAM/IR files with useful metadata (kind, size, date, used-by presets).
- Selecting/activating an asset loads it into the live rig, with the existing audition Keep/Revert
  safety net; importing from disk stores a deduplicated copy without necessarily changing the sound.
- Asset delete/rename cannot silently break presets: references are inspected and updated or blocked.
- Keep the existing fixed 1200×650 window, gold faceplate theme, full-window layout, keyboard
  navigation and search; no new dependencies.

### In Scope
- Backend: richer asset listing with metadata and reference counts; store-only import; explicit
  load; export-to-path; guarded delete; (phase 2) rename with reference rewriting.
- Frontend: replace `PresetLibrary` with `AssetLibrary`, change App's selection/keyboard/drop wiring,
  move preset JSON import/export into the amp board.
- Rust tests for the new helpers and command logic; README section; stale comment cleanup.

### Out of Scope
- Changing the preset board, slot layout, audition semantics for presets, or preset file format.
- Redesigning the amp faceplate, window chrome, or the NAM confirmation dialog on drop.
- Bundled `public/models/*` demo files, the old `app_data/irs` layout (`save_ir_file`) or the legacy
  `load_nam_from_*` bridges except to stop using them in the new view.
- A frontend test framework (none exists); validation is `cargo test`, `npm run build/lint` and manual QA.

# Technical Design

### Current Implementation
- `src/components/PresetLibrary.tsx:11–22` — `Filter = Bank | 'all'`, `SortKey = 'slot'|'name'|'updated'`,
  props `manager`, `onBack`, `selected` (preset name), `onSelect`.
- `PresetLibrary.tsx:24–134` — `PresetInspector`: preset rename, place-in-slot, move/copy, export JSON,
  delete, Edit… → `PresetEditor`; `:137–162` filter/sort over `manager.metas`; `:164–188` ↑/↓ + Ctrl+F;
  `:192–207` preset JSON import; `:210–239` header (bank chips, "Search presets…", Import…);
  `:241–286` rows keyed by preset name with Slot/Name/Model/IR/Updated columns and `PREVIEW`/`LOADED`
  badges; `:305–308` preset count footer. `PresetLibrary.css:99–105` defines that grid.
- `src/App.tsx:39–40` — `view: 'amp'|'library'`, `librarySelection: string | null` (preset name);
  `:147–183` Enter = `recallAt(selected preset)`, Esc = revert preset preview then back;
  `:86–118, 226–294` NAM/IR drops already call `importAsset` + `setModel`/`setIr` but do not refresh
  any asset list; JSON drops are Library-only; `:339–347` drop-overlay text; `:377–383` Library props.
- `src/hooks/usePresetManager.ts:100–202` — `applyLiveRig` and the preview backup/restore machinery
  (`beginPreview`/`commitPreview`/`revertPreview`) built on `loadRigAssets`; `:458–489` public surface.
- `src/hooks/useRigState.ts:23–26, 110–170` — `model`/`ir: AssetRef | null`, `snapshot()`,
  `applySnapshot()`, `clearModelAndIr()`, `setModel`/`setIr`.
- `src-tauri/src/commands.rs:872–933` — assets live at `<app_data>/library/<kind>/<hash6>/<name>`
  (`kind` = `nam` or `ir`); `AssetRef.id = "<kind>/<hash>/<name>"` (`:929–932`); `library_file_name`
  sanitises the stem and forces `.nam`/`.wav` (`:883–896`); `resolve_asset_path` blocks absolute ids
  and `..`/`.` (`:898–917`).
- `commands.rs:945–992` — `asset_refs_in_dir()` walks each kind and returns sorted `{id,name}`;
  `list_library_assets(kind)` is documented as being for the preset editor's pickers.
- `commands.rs:994–1028` — `import_asset` stores a deduped copy **and always loads it into the engine**
  (`:1021–1026`); `apply_rig_assets` (`:669–694`) is the shared NAM/IR loader used by `load_preset`
  and `load_rig_assets` (`:708–718`); presets are `<app_data>/presets/*.json` + `index.json`
  (`:475–568`). No asset metadata, delete, rename, export or reference counting exists.
- `src/tauri.ts:192–195, 231–239` — `listLibraryAssets(kind)` and `importAsset(...)` bridges.
- `src/types/preset.ts:7–13` — `AssetRef { id, name }` (comment still says `nams/...`, stale).
- `src/components/PresetEditor.tsx:61–62, 113` — asset pickers use `listLibraryAssets` / `importAsset`;
  these must keep working.
- `.junie/plans/full-window-library.md` — implemented full-window shell; open decision to lift
  search/filter state to `App` was never done. `.junie/plans/improve-preset-management.md:166–175`
  suggests `clean_library` in the Library; `:123–132` flags the `nams/` vs `nam/` id inconsistency.

### Key Decisions
1. **New `AssetLibrary.tsx` + `.css` instead of mutating `PresetLibrary`.** Reuse the full-window
   shell (back / title / search / filters / list / inspector / footer) but change every data source
   and action to assets. Delete `PresetLibrary` once no imports remain, or keep it as a thin
   compatibility wrapper only if needed during the transition.
2. **Keep `view === 'library'`** in `App` to avoid touching every view check; change only the label,
   selection type (asset id) and keyboard targets. Rename UI copy to "Model & IR Library".
3. **One combined `list_assets` command** (calls the existing walkers for both kinds) returning
   `AssetMeta { id, name, kind, extension, size, modified, usedBy: string[] }`. `usedBy` is computed
   by scanning `presets/*.json` and matching `rig.model.id` / `rig.ir.id`. Keep
   `list_library_assets(kind)` for `PresetEditor` pickers.
4. **Separate storing from loading.** Add `store_asset(kind, filename, path|data)` (same storage +
   dedupe as `import_asset`, but no engine side effect) for the Library's Import… button, and
   `load_asset(id)` that resolves the id and loads NAM bytes / IR path via the engine. Leave
   `import_asset` unchanged for drops and `PresetEditor` so existing behaviour is preserved.
5. **Preview uses the audition backup pattern.** Double-click / Enter in the list captures the
   current rig snapshot, calls `load_asset(id)`, and shows the existing preview banner; Keep commits,
   Revert restores via `loadRigAssets` + `applySnapshot`. Factor the backup/restore into a small
   reusable hook or expose equivalent methods from a new `useAssetLibrary` hook — do not duplicate
   the logic inline in the component.
6. **Deletion is reference-aware.** `delete_asset(id)` refuses by default when `usedBy` is non-empty;
   a confirmed "force" option removes the file, empties the hash folder, and strips the reference
   from affected presets and the live rig. Show the used-by preset names in the inspector and in the
   confirmation so the consequence is explicit.
7. **Rename is phase 2.** Because the name is part of the id and `ModelManager` keys cached models by
   display filename (`model_manager.rs:201–223`), renaming must sanitise with `library_file_name`,
   move the file, rewrite every preset's `AssetRef.id`, update the live rig, and reload the model.
   Ship list/import/load/preview/export/delete first; add rename only with those rewrites in place.
8. **Preset management moves to the amp board.** Add "Import preset…" (and "Export preset…" if
   desired) to `PresetBar`'s action row or slot context menu, using `importPresetFromPath` /
   `exportPresetToPath`. The preset JSON drop in `App.tsx` remains and no longer depends on the
   Library being open — drop JSON anywhere.
9. **Keep drop behaviour, refresh the list.** Drops still import + load immediately; after a
   successful `.nam`/`.wav` import, bump an asset-list refresh token so a Library that is open (or
   opened later) shows the new file.
10. **No changes to asset ids or storage layout.** Fix the stale `nams/...` comment in
    `types/preset.ts:9` and the stale id example in `improve-preset-management.md` instead.

### Proposed Changes

**Backend — `src-tauri/src/commands.rs` / `src-tauri/src/lib.rs`**
- New `AssetMeta` (`#[serde(rename_all = "camelCase")]`) with `id`, `name`, `kind`, `size`, `modified`,
  `usedBy`.
- `list_assets(app)` → both kinds via `asset_refs_in_dir`, plus `fs::metadata` for size/mtime and a
  preset scan for `usedBy` (reuse `parse_preset_json` / index helpers at `:570–656` where possible;
  ids in the test fixture may be legacy `nams/...`, normalise the prefix when counting).
- `store_asset(kind, filename, path, data)` → factor the storage half of `import_asset` (`:994–1028`)
  into a shared helper; no engine calls.
- `load_asset(app, engine, id)` → `resolve_asset_path`, then the same engine calls as
  `apply_rig_assets` (`:669–694`): NAM bytes via `load_nam_from_bytes(&name, bytes)`, IR via
  `load_ir(path)`.
- `export_asset_to_path(app, id, path)` → copy the resolved file with `fs::copy`.
- `delete_asset(app, id, force)` → guarded unlink + empty-hash-dir cleanup; on force, edit affected
  preset JSONs and return the refs for the UI to clear live state.
- Phase 2: `rename_asset(id, newName)` with sanitisation, file move, preset rewriting and a returned
  `AssetRef` for live-state update.
- Register every new command in `lib.rs:36–79`; add focused Rust unit tests for metadata listing,
  `usedBy` detection, sanitisation, and delete/refusal behaviour (temp app-data dir, like the
  existing `library_assets_keep_store_asset_ids` test at `:1199–1213`).

**Types / bridges — `src/types/preset.ts`, `src/tauri.ts`**
- `AssetKind = 'nam' | 'ir'`; `AssetMeta`; `AssetLibrarySnapshot` if listing both kinds at once.
- `listAssets()`, `storeAsset(kind, filename, path?, data?)`, `loadAsset(id)`,
  `exportAssetToPath(id, path)`, `deleteAsset(id, force?)`, later `renameAsset(id, newName)`.
  Keep `listLibraryAssets` / `importAsset` untouched for `PresetEditor` and drops.

**Frontend — `src/components/AssetLibrary.tsx` / `.css` (new)**
- Props: `onBack`, `selected: string | null` (asset id), `onSelect`, `assets`, `activeRefs`
  (`rig.model`/`rig.ir` ids), `previewing`, callbacks for load/preview/import/export/delete/rename,
  `busy`. Lifecycle: poll/refresh on mount and after mutations; Ctrl+F and ↑/↓ kept from
  `PresetLibrary.tsx:143–188`.
- Header: back, "Model & IR Library", "Search models and IRs…", kind chips `All / Models / IRs`,
  "Import…" (`openDialog` with `['nam','wav']` → `storeAsset`).
- List columns: Name / Kind / Size / Added / Used by (`AssetLibrary.css` grid replaces
  `PresetLibrary.css:99–105`); kind badge plus `LOADED`/`PREVIEW` badges based on `activeRefs`.
  Row click selects; double-click / Enter previews.
- Inspector: name, kind, size, hash (from id), added date, "Used by: preset names"; actions
  **Load as model / Load as IR** (kind-dependent), **Preview**, **Export…** (`saveDialog` with
  `nam`/`wav` filters), **Delete** (confirm, show used-by), phase 2 **Rename**.
- Footer: "N of M files · Model: … · IR: …", keyboard hints (↑↓ preview/select, Esc back/revert, Ctrl+F).
- `AssetLibrary.css`: derive from `PresetLibrary.css`, keep the shell/inspector/row states, add kind
  badges and a visible drop-target highlight; remove bank chips, slot cell, preset badges,
  bank/slot selects and preset editor modal styles that become unused.

**Frontend — `src/App.tsx` / `src/hooks`**
- Import `AssetLibrary`; `librarySelection` becomes an asset id; pass asset state/callbacks
  (`useAssetLibrary` hook) at `:377–383`. Keep `useMeters(view === 'amp' && ...)` unchanged.
- Keyboard (`:147–183`): Enter previews the selected asset; Esc reverts an asset preview before
  leaving the view; keep the dialog/menu precedence rule.
- Drops (`:86–118, 226–294`): after any NAM/IR import, bump the refresh token; drop JSON anywhere
  (remove the `view === 'library'` guard) and keep the NAM confirmation dialog.
- Move preset JSON import/export into `PresetBar` actions/context menu; `PresetLibrary` and its
  bridges (`exportPresetToPath`, `importPresetFromPath`) then have no UI caller except `PresetBar`.
- New `useAssetLibrary` hook: owns `assets`, refresh, selection-independent preview backup
  (snapshot + Keep/Revert reusing `loadRigAssets`/`applySnapshot`), busy flags and mutation wrappers
  with notifications.

**Docs / cleanup**
- README: describe the asset Library and the new preset import location.
- Fix `AssetRef` comment (`types/preset.ts:9`) and stale `nams/` examples in plans/tests where safe;
  mark plan steps as they land.

### Delivery Steps
- [x] **Step 1 — Backend read path.** `AssetMeta`, `list_assets`, TS types/bridge, Rust tests.
      `cargo test`: 32 passed, 1 known unrelated `model_manager` fixture failure; build passes.
- [x] **Step 2 — Asset actions.** `store_asset_file`, `load_asset`, `export_asset_to_path`, guarded
      `delete_asset` + bridges; verified with `cargo test` / lint.
- [x] **Step 3 — New Library UI.** `AssetLibrary.tsx/.css`, `useAssetLibrary` hook, swapped into `App.tsx`,
      selection/keyboard/drop refresh retargeted. `PresetLibrary.tsx/.css` removed.
- [x] **Step 4 — Move preset JSON actions.** Import preset… / Export… added to the `PresetBar` slot menu;
      JSON drops now work in every view.
- [x] **Step 5 — Phase 2 (optional).** `rename_asset` with preset-reference rewriting and live-rig reload;
      `clean_library` with keep-list for currently loaded files plus a confirmed UI action.
- [x] **Step 6 — QA + docs.** README updated. Manual checklist below still needs a live-device pass.

### Manual QA checklist
- Library lists all stored NAM and IR files with correct kind/size/date and used-by names.
- Search, kind filter, sort and ↑/↓ navigation work; Ctrl+F focuses search.
- Import a `.nam` and a `.wav` from disk: files appear in the Library but the live sound is unchanged
  until loaded; duplicates are deduped by content hash.
- Double-click / Enter previews an asset: sound changes, banner shows PREVIEW; Keep commits, Esc/Revert
  restores the previous model+IR and knobs.
- "Load as model" / "Load as IR" works with no NAM/IR loaded and while a preset is loaded.
- Export writes the original bytes to the chosen path with the right extension.
- Delete of an unused asset succeeds and removes an empty hash folder; delete of a used asset warns and
  is refused unless forced; forced delete updates/clears preset references and the live rig.
- Drop a NAM/IR while the Library is open (and from the amp view): it still loads and the list refreshes.
- Drop a preset JSON from any view: it imports and the amp board updates.
- Preset board (save/recall/rename/move/copy/delete, slot menu, Edit…) still works with the Library gone.
- Phase 2: renaming an asset updates every preset that referenced it and the model reloads under the
  new name.

### Open decisions (resolve during implementation)
- **Preview vs. immediate load:** recommended preview with Keep/Revert for parity with presets;
  immediate load is simpler but risks losing the current rig unknowingly.
- **Metadata columns:** `size`/`modified` are cheap; a hash column is derivable from the id. Add only
  what is readable in the fixed window width.
- **Force-delete policy:** refuse-and-require-confirm vs. always strip references automatically; the
  plan recommends explicit confirmation listing affected presets.
- **Rename and cleanup:** valuable but higher risk (id/reference rewriting); defer to phase 2 if the
  first release only needs browsing/loading/importing.
- **State lifting:** `full-window-library.md` recommended lifting search/filter to `App`; keep local
  state unless the new hook needs to coordinate it with drop refresh.
