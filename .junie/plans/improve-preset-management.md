# Improve Preset Manager for NAMpli

# Context

Preset management was delivered in `preset-manager.md` (backend, hooks, `PresetBar`,
`PresetLibrary`, drag-and-drop, README). The feature works end-to-end, but a review of the
current code found a handful of correctness gaps, one major portability gap (JSON export
does not carry the NAM/IR files), stale documentation, and no automated coverage for the
frontend. This plan proposes concrete, prioritized follow-up work.

This document **supplements** `preset-manager.md`; it does not replace it. The original design
needs a small accuracy pass anyway (it says six knobs; there are now seven — reverb was added).

## Current state (verified)

- Storage: `app_data/presets/<sanitized-name>.json` plus `app_data/presets/index.json`;
  assets are content-addressed copies under `app_data/library/{nam,ir}/<hash>/<file>`.
- Backend commands live in `src-tauri/src/commands.rs:680–919` and are registered in
  `src-tauri/src/lib.rs:61–70`.
- Frontend state machine: `src/hooks/usePresetManager.ts`; rig snapshot: `src/hooks/useRigState.ts`.
- Types mirrored in `src/types/preset.ts` and `src-tauri/src/commands.rs:372–495`.
- UI: `src/components/PresetBar.tsx`, `src/components/PresetLibrary.tsx`, wired in `App.tsx`.
- Only four Rust unit tests exist (`commands.rs:1033–1088`); there is no frontend test script.

# Goals / Non-goals

**Goals**
1. Make save/rename/import/delete lossless and collision-safe (no preset can be silently lost).
2. Make exported presets portable across machines / clean app profiles.
3. Make dirty tracking, A/B compare, and error messages predictable.
4. Bring documentation and tests in line with the implementation.

**Non-goals**
- Changing the DSP, the 2×4 bank/slot model, audio-device settings, or the fixed 1200×650 window.
- Cloud sync, factory preset packs, MIDI footswitch control, or a new UI theme.
- Storing visualization/power/global audio settings in presets (explicitly out of scope before).

# Prioritized improvements

## P0 — Data integrity (do first)

### P0.1 Atomic slot replacement on save

- **Problem**: `usePresetManager.save` deletes the occupying preset before writing the new one
  (`src/hooks/usePresetManager.ts:154–157`). If `savePreset` then fails, the old preset is gone.
- **Change**: Move the replace decision into the backend. Give `write_preset` a "replace occupant"
  path that writes the file and updates `index.json` as one logical operation; reject a slot
  collision with a typed error (already possible at `commands.rs:640–647`). The frontend should
  stop calling `deletePreset` for the occupant and instead pass a `replace: true` flag (new
  `save_preset` argument or a dedicated `replace_preset` command).
- **Acceptance**: killing/interrupting the save or forcing a write error leaves the previous
  preset intact; overwriting a slot with a different name overwrites in place; no toast on success
  claims success unless the index and file both succeeded.

### P0.2 Import: legacy tolerance + explicit slot resolution

- **Problem**: `import_preset` parses with strict `serde_json::from_str` (`commands.rs:775–776`)
  while normal loads use `parse_preset_json` (`:592–620`), so legacy flat JSON cannot be imported.
  It also defaults `slot 0 → 1` (`:781–783`), then fails at `write_preset` if A1 is occupied, with
  no slot picker in the UI.
- **Change**:
  - Route import through `parse_preset_json` so legacy blobs migrate on import too.
  - Resolve the destination explicitly: prefer the payload's bank/slot when free, otherwise choose
    the first free slot in the same bank (or A), and return the **resolved** bank/slot in
    `PresetMeta` so the UI can show where it landed. If all eight slots are occupied, return a
    clear `No free preset slot` error instead of a slot-range error.
  - Reject duplicate names with the existing message.
- **Acceptance**: a legacy blob imports and recalls with knobs restored; importing into a full grid
  shows an actionable error; the toast names the target slot.

### P0.3 Remove unreachable overflow slots

- **Problem**: `sync_index` assigns `slot = 100 + count` beyond eight presets (`commands.rs:575–578`),
  but `write_preset` rejects slots outside 1–4 (`:636–638`) and `PresetBar` only renders slots 1–4
  (`SLOTS`). Those presets are visible only in the Library and cannot be recalled or overwritten.
- **Change**: keep the 2×4 grid as the single source of truth. Stop assigning overflow slots; make
  index reconciliation skip/orphan-report extra files explicitly (e.g. surface them in the Library
  as "unassigned" with a "move to free slot" action) rather than fabricating slot numbers that the
  rest of the app cannot address. Decide the desired cap behaviour in P0.2 (first-free-slot / full
  error) and apply it consistently.
- **Acceptance**: every preset in `index.json` has a bank A/B and slot 1–4; no UI action can create
  an unrecallable preset.

### P0.4 Make A/B compare race-free

- **Problem**: `selectAt` fires `clearModelAndIr()` without awaiting (`usePresetManager.ts:123`)
  while `compare()` swaps snapshots (`:220–243`); the `compareBackup.current === null` check at
  `:242` is effectively dead code. A second compare or a slot click mid-compare can leave the
  backup stranded.
- **Change**: await the clear/recall inside compare; guard all mutating actions (`recallAt`,
  `selectAt`, `save`, `remove`, `importJson`, `compare`) with one busy/lock flag so only one operates
  at a time. Clear the backup on any user action that leaves compare mode.
- **Acceptance**: A→B→A restores the exact snapshot, bank, slot, name and dirty baseline; rapid
  clicks do not strand `comparing=true`; compare never writes to disk.

## P1 — Portability (the biggest real-world gap)

### P1.1 Embed assets in export / restore them on import

- **Problem**: `export_preset*` (`commands.rs:760–771`) writes only `AssetRef.id`, which points into
  the local `app_data/library/`. Importing that JSON on another machine (or a clean profile) makes
  `load_preset` fail with `Missing preset asset ...` from `resolve_asset_path` (`:838–857`).
- **Change**: define a portable envelope, keeping plain v1 JSON accepted:
  ```ts
  interface PresetBundle {
    format: 'nampli-preset';
    version: 2;
    preset: PresetPayload;
    assets: Record<string, { name: string; data: string /* base64 */ }>;
  }
  ```
  - Export: read each referenced asset from the library, include base64 bytes keyed by `AssetRef.id`,
    and omit `assets` when there are none. `export_preset_to_path` writes the bundle.
  - Import: detect bundle vs plain JSON; store each asset via the existing deduping `store_asset`
    (`:859–873`), rewrite `AssetRef.id` to the locally stored id, then `write_preset`. Keep the
    display name. If an asset is missing/corrupt, fail with a clear message naming the asset rather
    than writing a broken preset.
  - Consider a size guard + warning for large NAM/IR files (they can be tens of MB).
- **Acceptance**: export on profile A, import on a clean profile B, recall: knobs + NAM + IR all
  restore and sound identical; importing an old plain JSON still works (without assets).

### P1.2 One source of truth for asset ids

- **Problem**: TS docs `src/types/preset.ts:9` say ids look like `nams/ab12cd34/...`, but the backend
  stores kind `nam`/`ir` (`commands.rs:870`); test fixtures use yet another spelling
  (`commands.rs:1049–1050`).
- **Change**: define the id format once in Rust (helper + validation in `resolve_asset_path`) and
  mirror the exact documentation in `src/types/preset.ts`. Update fixtures and any parsing to use
  the same helper. Reject unknown/malformed ids early on import.
- **Acceptance**: no id-format ambiguity; malicious ids (absolute paths, `..`, current-dir) are
  rejected as today, and a unit test covers each accepted/rejected shape.

## P2 — Predictable UX

### P2.1 Dirty semantics and float comparison

- **Problem**: selecting an empty slot sets `baseline = {...snapshot, model: null, ir: null}`
  (`usePresetManager.ts:122`), so the dirty dot stays clear even though knobs differ from defaults;
  `sameRig` uses strict float equality (`:39–45`).
- **Change**: when an empty slot is selected, base "dirty" on `DEFAULT_RIG` (the state Save will
  actually write) — or show a distinct "unsaved working state" indicator if the intent is to keep
  knob positions. Use an epsilon (e.g. `1e-4`) for knob comparison. Make the rule explicit in the
  README and the plan.
- **Acceptance**: the dirty dot matches "would Save change anything?" in all four slot states
  (occupied/empty × model present/bypass).

### P2.2 Make the NAM confirmation consistent

- **Problem**: native drops show the "Load NAM model?" dialog (`App.tsx:108–110, 124–137`), but the
  browser/base64 fallback loads immediately (`App.tsx:236–238`).
- **Change**: funnel both paths through one confirm step before `importAsset`.
- **Acceptance**: dropping a `.nam` always asks once, regardless of runtime.

### P2.3 Actionable errors for missing assets

- **Problem**: a stale/missing library file yields a low-level `Missing preset asset ...` toast when
  recalling.
- **Change**: catch this in `load_preset` and return a specific error naming the preset and asset,
  with a suggested recovery ("delete the preset or re-import the model"). Optionally surface an
  "asset missing" badge in `PresetLibrary` using metadata already available.
- **Acceptance**: users can tell which preset/asset is broken and what to do next.

## P3 — Hygiene, docs, and tests

### P3.1 Asset garbage collection

- **Problem**: deleting or overwriting presets never removes unreferenced copies in
  `app_data/library/` (`delete_preset` at `commands.rs:720–729`). This was deferred in the original
  plan.
- **Change**: add a `clean_library` command that deletes files not referenced by any preset in
  `index.json`, exposed as "Clean up library…" in `PresetLibrary` with a preview count and
  confirmation. Keep it manual (no automatic deletion on save).
- **Acceptance**: after cleanup, the library directory contains only referenced assets; recall of
  every remaining preset still works.

### P3.2 Documentation accuracy pass

- Update `preset-manager.md`: six → seven knobs (add reverb), check off delivered steps (all seven),
  remove/replace the `SettingsPanel.tsx` IR item (`SettingsPanel` no longer handles IRs), and resolve
  the open decisions (A/B compare kept, factory presets deferred, library cleanup → P3.1 above).
- Update `reverb-knob.md` delivery checkboxes. Mark `unnamed-mode-drop.md` as obsolete/superseded
  (it references the deleted `presetBarStore.ts`).
- Extend the README with the portable-export behaviour and the new cleanup action.

### P3.3 Automated coverage

- Rust (`src-tauri/src/commands.rs` tests): add cases for atomic slot replacement, legacy JSON
  import, portable bundle export/import (including asset rewrite), asset dedupe, and bypass recall
  (`model: null` / `ir: null`).
- Frontend: add Vitest + `react-testing-library` with scripts in `package.json` (`test`, `test:run`).
  Unit-test `sameRig`/dirty transitions, compare backup restoration, and the import slot-resolution
  decisions (pure helpers extracted from `usePresetManager`).
- Keep `npx tsc --noEmit`, `npm run lint`, and `cargo check` green after each phase.

# Delivery order

- [ ] **Phase 1 — P0 integrity**: P0.1 atomic save, P0.2 import + slot resolution, P0.3 overflow
      removal, P0.4 compare lock. Rust tests first where practical. Verify `cargo check`.
- [ ] **Phase 2 — P1 portability**: P1.1 bundle format + import path, P1.2 id helper/docs. Round-trip
      export → clean-profile import → recall.
- [ ] **Phase 3 — P2 UX**: P2.1 dirty semantics, P2.2 single confirm path, P2.3 actionable errors.
      Verify `npx tsc --noEmit` and `npm run lint`.
- [ ] **Phase 4 — P3 hygiene**: P3.1 cleanup command + UI, P3.2 doc pass, P3.3 test infra and cases.
- [ ] **Phase 5 — Manual QA**: on the native app, check save → restart → recall (knobs + NAM + IR),
      bypass recall, dirty dot clearing, A/B compare writing nothing, rename/delete slot order,
      overwrite recovery on simulated failure, export/import on a clean profile, and no audio glitch
      on recall.

# Open decisions to resolve during Phase 1/2

- Overwrite API: add `replace: bool` to `save_preset`, or a separate `replace_preset` command?
  (Recommendation: `replace: bool` — one command, index stays authoritative.)
- Full-grid import behaviour: auto-place in first free slot (recommended) vs ask the user via a
  slot-picker dialog.
- Bundle size limit / warning threshold for embedded assets.
- Keep eight total slots as a hard cap, or add banks C/D later (data model already allows it).
