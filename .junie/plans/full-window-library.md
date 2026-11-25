# Full-window Preset Library for NAMpli

> **Status: implemented (Phases 1–5).** Automated checks pass; native interactive QA (Phase 6)
> is still pending. Copy creates a uniquely named duplicate via `get_preset` + `savePreset`
> rather than a dedicated backend command.

# Context

Preset management currently has two surfaces: a compact `PresetBar` on the amp faceplate and a
`PresetLibrary` **modal popup** (`src/components/PresetLibrary.tsx`, `PresetLibrary.css`) rendered
as `.preset-library-overlay` from `App.tsx:306`. The popup is 720×80vh with a 230px side panel,
a focus trap (`useDialogFocus`), and click-outside dismissal.

Now that the board has 16 slots (banks A–D) and JSON import/export exists, the library needs room
for browsing, sorting, metadata and slot management. This plan makes it a **full-window view**
that replaces the amp panel, like the library screen in a DSP plugin or a DAW browser, while
keeping the audition/revert workflow intact.

This document **supplements** `improve-preset-management.md`: that plan's metadata/tags/search
and cleanup ideas become much easier once the library has a full-window surface.

# Goals / Non-goals

**Goals**
1. Library occupies the whole app window instead of a centered dialog; the amp panel is hidden while it is open.
2. Navigation in and out is obvious and keyboard-friendly, with no ambiguity against audition/revert keys.
3. All existing library actions (recall, rename, export, import, delete) work unchanged in the new view.
4. Browsing scales to 16+ presets: search, bank filter, sortable columns, internal scrolling.
5. Presets can be moved/copied between bank/slot addresses from the library itself.
6. Dropping a preset `.json` into the library imports it; dropped NAM/IR files keep working.

**Non-goals**
- Changing the 4×4 slot model, the preset JSON schema, or the DSP.
- Cloud sync, factory packs, or modifying the amp faceplate while the library is open.
- Reworking tags/favorites metadata (that remains a separate item in `improve-preset-management.md`,
  though the layout here reserves space for it).

# UX design

### View switch
- `App` owns a single view state (`'amp' | 'library'`), replacing `showLibrary: boolean`.
- Entering: the **Library** button in `PresetBar` (or `Ctrl/Cmd+L`) switches views.
- Exiting: a persistent **← Back to amp** button in the library header, plus `Esc` (see key precedence).
- While in library view, `.app-content` renders the library screen **instead of** `<AmpPanel>`.
- Keep the window tools, `AudioStatusBar`, `Toast` and the audition banner mounted in both views so
  status messages and preview controls never disappear. The drop-zone overlay also stays.

### Layout (fixed 1200×650, no page scrolling)
```
┌──────────────────────────────────────────────────────────────┐
│ window tools · status bar · (audition banner when previewing)│
├──────────────────────────────────────────────────────────────┤
│ ← Back to amp   PRESET LIBRARY   [Search…] [All|A|B|C|D] [Import…] │
├────────────────────────────────────────┬─────────────────────┤
│ Bank/Slot │ Name │ Model │ IR │ Updated│ Inspector / details │
│ ────────────────────────────────────── │ name, A1–D4 selector │
│ A1  Groovy Bass  JCM800… Fender…  …    │ Recall / Rename      │
│ A2  …                                 │ Export / Delete      │
│ ⋮ (internal scroll)                   │ Move to… / Copy to…  │
├────────────────────────────────────────┴─────────────────────┤
│ N presets · ↑↓ navigate · Enter audition · Esc back/revert    │
└──────────────────────────────────────────────────────────────┘
```
- Header: search input, bank filter chips (`All / A / B / C / D`), Import…, Back.
- List: full-width table-like rows with bank/slot badge, name, model, IR, updated date. Click selects,
  double-click (or Enter) auditions. Column headers sort by name / bank-slot / updated.
- Inspector: shows the selected preset and hosts rename, recall/audition, export, delete, and a
  bank/slot picker for Move/Copy. Inline rename is preferable to the current side-panel text field.
- The list scrolls internally; the overall `.app` keeps `overflow: hidden` so the 650px window never scrolls.

### Key precedence (important)
Audition/revert already owns Enter and Escape. Define one explicit order and show it in the footer:
- **Esc**: if an audition is active → revert it and stay in the library; otherwise → return to the amp view.
  The visible **Back to amp** button is always available, so navigation never depends on this rule.
- **Enter**: if an audition is active → keep it; otherwise → audition the selected preset.
- **↑ / ↓**: move the list selection. **Ctrl/Cmd+F**: focus search. **Delete**: delete selected (with confirm).
- The audition banner's Keep/Revert buttons remain the unambiguous mouse path.

# Technical design

### Frontend
- **`src/App.tsx`**
  - Replace `showLibrary` with `view` state; keep `openLibrary` / `backToAmp` callbacks.
  - Render `<PresetLibrary>` as a view (not an overlay) in place of `<AmpPanel>`; pass `onBack`.
  - Remove `useDialogFocus(showLibrary, …)` from the library — it is no longer a modal.
  - Extend the native/browser drop handlers: if the dropped file ends in `.json` and `view === 'library'`,
    call `importPresetFromPath` (native) or base64 `importPreset` (browser), then `manager.refresh()`.
    Keep existing `.nam`/`.wav` handling regardless of view.
  - Keep the audition key handler, but update it to the precedence above and make it view-aware.
- **`src/components/PresetLibrary.tsx`**
  - Remove overlay wrapper, `role="dialog"`, `aria-modal`, backdrop click and `useDialogFocus`.
  - Root becomes `<section className="preset-library" role="region" aria-label="Preset library">`.
  - Own `query`, `bankFilter`, `sortKey`, and `selected` state; derive the visible list with `useMemo`.
  - Move/copy calls `manager.move(name, bank, slot, mode)` (new manager action); collision confirmation lives
    in the manager, consistent with `save`/`remove`.
  - Keep current actions: `Recall` → `manager.recallAt`, rename, `exportPresetToPath`, `manager.remove`,
    `importPresetFromPath` + `manager.refresh`.
  - Focus search on entry; restore focus to the Library button on exit (simple `ref`/effect, no focus trap).
- **`src/components/PresetLibrary.css`**
  - Delete `.preset-library-overlay`; make `.preset-library` fill `.app-content` (`width: 100%; height: 100%;`),
    flex column, header / body / footer.
  - Body: `display: flex; min-height: 0;` list `flex: 1; overflow-y: auto;` inspector fixed width; no
    `max-height: 80vh` or centering. Preserve the brass palette and row styling.
- **`src/hooks/usePresetManager.ts`**
  - Add `move(name, bank, slot, mode: 'move' | 'copy')` wrapping a new backend command; confirm on
    collision, refresh metadata, toast the destination.
- **`src/types/preset.ts`** — optionally export a `BankFilter = Bank | 'all'` type for the filter chips.

### Backend
- Add `move_preset(name: String, bank: String, slot: u8, replace: bool)` in `src-tauri/src/commands.rs`:
  validate bank/slot, check the destination occupant, then atomically update `index.json` and the
  preset payload (reusing `write_preset` validation). Reject collisions when `replace == false`.
  Register it in `src-tauri/src/lib.rs` and add a wrapper in `src/tauri.ts`.
- No storage-format changes: moving only edits the index entry and the `bank`/`slot` fields of the JSON.

### Docs
- Update `README.md` ("Library" bullet) to describe it as a full-window view with search/filter and move/copy.
- Add a status note to `.junie/plans/full-window-library.md` as phases complete.

# Delivery steps

- [x] **Phase 1 — View swap.** Replace modal with a full-window view in `App.tsx` and
      `PresetLibrary.tsx`/`.css`; Back button and view state; remove `useDialogFocus` usage and overlay CSS.
      Verify at 1200×650 that nothing scrolls at page level.
- [x] **Phase 2 — Browse.** Header search, bank filter chips, sortable list columns, footer hints,
      keyboard selection (↑/↓, Ctrl/Cmd+F), focus management on enter/exit.
- [x] **Phase 3 — Audition integration.** Define/test Enter/Esc precedence; recall from the list shows
      the existing banner; Keep/Revert work without leaving the library; preview keys never fire inside
      the search field or rename input.
- [x] **Phase 4 — Organize.** Inspector redesign (inline rename, bank/slot picker), backend
      `move_preset` + `manager.move`, collision confirmations, Move/Copy actions.
- [x] **Phase 5 — Import drops.** `.json` drop → import preset in library view; NAM/IR drops unchanged;
      toast + refresh after import.
- [ ] **Phase 6 — Polish & QA.** `npx tsc --noEmit`, `npm run lint`, `npm run build`, `cargo check`.
      Manual checklist: enter/exit with button and Esc; 16 presets render and list scrolls; search and
      bank filter; rename/export/import/delete; move A1→C3 including occupied target; audition → Keep and
      audition → Revert from the library; key precedence with search focused; drop `.json`, `.nam`, `.wav`;
      no layout overflow at 1200×650.

# Open decisions

- Keep top chrome (tools, status bar, audition banner) visible in library view? Recommendation: yes.
- Preserve search/filter/selection when leaving and returning? Options: lift state to `App`, or keep the
  component mounted and hidden. Recommendation: lift to `App` for a predictable back-and-forth.
- Move vs copy as separate actions, or one "Place in slot…" with a checkbox? Recommendation: separate
  actions in the inspector.
- Should the amp faceplate `PresetBar` stay mounted (hidden) so its state is preserved, or fully unmount?
  Recommendation: unmount; all relevant state lives in `usePresetManager`, not in the component.
- Add `Ctrl/Cmd+L` as a view shortcut, or keep the Library button as the only entry point?
