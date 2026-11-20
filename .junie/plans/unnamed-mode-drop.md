---
sessionId: session-261116-131351-ff11
---

# Requirements

### Overview & Goals
Implement an "Unnamed" mode triggered when a `.nam` or `.wav` (IR) file is dropped on the main app screen. The file loads immediately into the audio engine, the preset header shows "Unnamed", and no preset slot is associated until the user clicks "Save preset" to pick a slot.

### User Story
As a user, I want to drop a NAM or IR file on the main screen so that it loads immediately without having to open the preset library first. When I'm ready, I can save it to a preset slot.

### Functional Requirements
- **Drag-and-drop on main screen**: Dropping a `.nam` or `.wav` file anywhere on the app window (when the preset library is not open) triggers the unnamed mode.
- **Visual feedback**: A drop-zone overlay appears when dragging a file over the app window.
- **Immediate load**: The NAM/IR loads into the audio engine right away.
- **Header shows "Unnamed"**: The preset carousel in `AmpPanel` displays "Unnamed" instead of "ByPass" or a slot name.
- **"Save preset" button**: A button appears in the header that opens the preset library so the user can save the current settings (including the loaded NAM/IR) to a slot.
- **Save preset flow**: When saving from unnamed mode, the user picks a slot in the preset library; the NAM file is copied to the slot's directory and the preset is saved normally.
- **IR drops**: Dropping a `.wav` file also triggers unnamed mode (same behavior as NAM).
- **Multiple drops**: If a NAM is already loaded in unnamed mode and another is dropped, it replaces the previous one.

### Out of Scope
- Dropping on the preset library slots (existing behavior, unchanged).
- Renaming the unnamed preset before saving.
- Bounding the drop zone to only the amp panel (the entire app window is the drop zone).

# Technical Design

### Current Implementation
- **Drag-and-drop** for NAM/IR files only exists in `PresetLibrary.tsx` (per-slot drops). The main screen (`App.tsx` / `AmpPanel.tsx`) has no drop handling.
- **NAM file saving** (`save_nam_file` in `commands.rs`) requires a `slot` parameter and saves to `app_data/presets/<bank>/<slot>/`. IR saving (`save_ir_file`) saves to `app_data/irs/` and needs no slot.
- **Preset state** is owned by `SettingsPanel.tsx` (always mounted). It exposes state to `AmpPanel.tsx` via `presetBarStore.ts` (`PresetBarActions` interface with `slots`, `currentSlot`, `isDirty`, `modelName`, `irName`, `loadSlot`).
- **AmpPanel header** shows "ByPass" when `currentSlot` is null, or the preset name otherwise.
- **Backend**: `load_nam_by_path` can load any NAM from an arbitrary path into the audio engine.

### Key Decisions
1. **New backend command `save_nam_file_unnamed`**: Saves a NAM file to `app_data/nams/` (the existing NAM models directory) without requiring a slot. This avoids creating a fake slot and keeps the unnamed NAM separate from preset data.
2. **Extend `PresetBarActions`** with `isUnnamed`, `unnamedModelName`, `unnamedIrName`, and `saveUnnamed` to signal the unnamed state and provide a save action.
3. **Drag-and-drop in `App.tsx`**: Add global drop handlers in `App.tsx` (the root component) so the entire window is a drop zone. A visual overlay shows on drag-over.
4. **SettingsPanel handles the load logic**: `App.tsx` delegates the actual file processing to `SettingsPanel` via new methods on `PresetManager` to keep all audio engine interaction in one place.
5. **Save preset from unnamed mode**: Opens the preset library; the current state (including NAM/IR paths) is available to save to any slot.

### Proposed Changes

**Backend (`src-tauri/src/commands.rs`)**
- Add `save_nam_file_unnamed(filename, data)`: saves the NAM to `app_data/nams/<sanitized_name>.nam` and returns the path.

**Backend (`src-tauri/src/lib.rs`)**
- Register the new command.

**Frontend Tauri bridge (`src/tauri.ts`)**
- Add `saveNamFileUnnamed(filename, data): Promise<string>`.

**Preset types (`src/types/preset.ts`)**
- Extend `PresetBarActions` with `isUnnamed: boolean`, `unnamedModelName: string | null`, `unnamedIrName: string | null`, `saveUnnamed: () => void`.
- Extend `PresetManager` with `loadUnnamedNam: (path: string) => void` and `loadUnnamedIr: (path: string) => void`.

**SettingsPanel (`src/components/SettingsPanel.tsx`)**
- Add state: `isUnnamed`, `unnamedModelName`, `unnamedIrName`, `unnamedNamPath`, `unnamedIrPath`.
- Implement `handleLoadUnnamedNam(path)` and `handleLoadUnnamedIr(path)`.
- Implement `handleSaveUnnamed`: opens preset library view.
- Update `setPresetBarActions` and `presetManager`.

**App (`src/App.tsx`)**
- Add drag-and-drop handlers on the root `<div className="app">`.
- Add `dragOver` state and render a drop-zone overlay.
- On drop: read file, save via backend, call `loadUnnamedNam`/`loadUnnamedIr`.

**AmpPanel (`src/components/AmpPanel.tsx`)**
- When `actions.isUnnamed`, show "Unnamed" as title, NAM/IR name in subtitle, and a "Save preset" button.

**Styles**
- `App.css`: drop-zone overlay styles.
- `AmpPanel.css`: "Save preset" button styles.

### File Structure
- **Modified**: `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`, `src/tauri.ts`, `src/types/preset.ts`, `src/components/SettingsPanel.tsx`, `src/App.tsx`, `src/components/AmpPanel.tsx`, `src/App.css`, `src/components/AmpPanel.css`

# Testing

### Key Scenarios
1. **Drop NAM on main screen**: File loads, header shows "Unnamed" with NAM name, "Save preset" button appears.
2. **Drop IR on main screen**: File loads, header shows "Unnamed" with IR name, "Save preset" button appears.
3. **Save preset from unnamed mode**: Opens preset library, user picks a slot, preset saves with the NAM/IR path.
4. **Drop NAM while unnamed mode active**: Replaces the previous NAM.
5. **Drop unsupported file**: No action, no error.
6. **Load a preset slot while in unnamed mode**: Clears unnamed state, loads the slot normally.

### Edge Cases
- Drop when preset library is open: should not trigger unnamed mode (drop should go to the slot handler).
- Save to an occupied slot: should prompt for overwrite confirmation.

# Delivery Steps

### ✓ Step 1: Add backend command for unnamed NAM saves
Add `save_nam_file_unnamed` to `commands.rs`, register it in `lib.rs`, and add the frontend bridge in `tauri.ts`.
- Implement `save_nam_file_unnamed(filename, data)` in `src-tauri/src/commands.rs`: saves the base64-decoded NAM to `app_data/nams/<sanitized_name>.nam` and returns the path.
- Register the command in `src-tauri/src/lib.rs`.
- Add `saveNamFileUnnamed` to `src/tauri.ts`.

### ✓ Step 2: Extend preset types and SettingsPanel for unnamed mode
Add unnamed state fields to `PresetBarActions` and `PresetManager`, then implement the handlers in `SettingsPanel`.
- Extend `PresetBarActions` in `src/types/preset.ts` with `isUnnamed`, `unnamedModelName`, `unnamedIrName`, and `saveUnnamed`.
- Extend `PresetManager` with `loadUnnamedNam(path)` and `loadUnnamedIr(path)`.
- Add state variables and handlers in `src/components/SettingsPanel.tsx`: `isUnnamed`, `unnamedModelName`, `unnamedIrName`, `unnamedNamPath`, `unnamedIrPath`.
- Implement `handleLoadUnnamedNam` (calls `tauriLoadNamByPath`, sets unnamed state, clears `loadedSlot`/`loadedState`).
- Implement `handleLoadUnnamedIr` (calls `tauriLoadIr`, sets unnamed state, clears `loadedSlot`/`loadedState`).
- Implement `handleSaveUnnamed` (opens preset library view).
- Update `setPresetBarActions` and `presetManager` to expose new fields and methods.

### ✓ Step 3: Add drag-and-drop to main screen with overlay
Add global drag-and-drop handling to `App.tsx` with a visual drop-zone overlay.
- Add `dragOver` state to `App.tsx`.
- Add `onDragOver`, `onDragEnter`, `onDragLeave`, `onDrop` handlers on the root `<div className="app">`.
- On drop: read the file as base64, call `saveNamFileUnnamed` or `saveIrFile` (backend), then call `loadUnnamedNam`/`loadUnnamedIr` via the preset store.
- Render a drop-zone overlay (semi-transparent div with "Drop NAM or IR file" text) when `dragOver` is true and the preset library is not open.
- Add overlay styles to `App.css`.

### ✓ Step 4: Update AmpPanel for unnamed mode UI
Show "Unnamed" title and "Save preset" button in `AmpPanel.tsx` when in unnamed mode.
- When `actions.isUnnamed` is true, display "Unnamed" as the title instead of "ByPass".
- Show the loaded NAM/IR name in the subtitle.
- Add a "Save preset" button next to the title that calls `actions.saveUnnamed()`.
- Add button styles to `AmpPanel.css`.

### ✓ Step 5: Fix SettingsPanel unmounting bug
The component returned `null` when no view was open, unmounting the event listeners for file drops. Changed to return an empty fragment `<></>` so the component stays mounted and the unnamed mode state persists.
- Changed `if (view === null) return null;` to `if (view === null) return <></>;` in `SettingsPanel.tsx`.

### ✓ Step 6: Fix unnamed state not set when audio engine call fails
In `handleLoadUnnamedNam` and `handleLoadUnnamedIr`, the unnamed state was only set AFTER the audio engine call (`tauriLoadNamByPath`/`tauriLoadIr`). If the audio engine wasn't running yet, the call threw an error and the state was never set, so the UI continued to show "ByPass". Fixed by setting the unnamed state first, then making the audio engine call best-effort.
- Moved `setIsUnnamed(true)`, `setLoadedSlot(null)`, etc. before the `await tauriLoadNamByPath`/`tauriLoadIr` calls.
- Wrapped the audio engine calls in inner try-catch so failures don't prevent the state from being set.