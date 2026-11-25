# Fix preset submenu rendering depth

# Requirements

### Overview
The slot context menu (the "Save here / Save As… / Edit… / Rename… / Delete" popup) renders with the
amp faceplate painted **on top of it**: the gold `NAMpli` title, the green `LIVE` chip and knob scale
numbers show through the opaque menu panel (see the supplied screenshot). This is a stacking-context
bug, not transparency: `.preset-menu` has an opaque `#15130f` background and no fade/transform.

### Goals
- The context menu must paint above the whole faceplate and never have panel content drawn over it.
- Keep the existing placement at the cursor / keyboard-anchor, dismissal behaviour, keyboard opening
  and styling unchanged.
- Apply the same treatment to the other two preset overlays (save/rename dialog and `PresetEditor`),
  which are nested in the same subtree and carry the same latent risk.
- No dependency changes, no layout/window changes, no changes to preset logic.

### Out of Scope
- Redesigning the menu, changing its items, colours or dimensions.
- Removing `overflow: hidden` from `.amp-panel` (it protects the fixed faceplate layout).
- Fixing unrelated z-index values of overlays that already work (status bar, tuner, settings,
  toasts, confirm dialog).

# Technical Design

### Current Implementation
- `src/components/PresetBar.tsx:171–227` — `.preset-menu` is rendered **inline** as a descendant of
  `.preset-bar`, i.e. `.app → .app-content → .amp-panel → .preset-rail → .preset-bar → .preset-menu`.
  Positioning is `position: fixed` with inline `left/top` from `menu.x/menu.y` (`:175`), set from
  `clientX/clientY` (`:56–60`) or `getBoundingClientRect()` (`:62–67`), clamped at `:51–52`.
- `src/components/PresetBar.tsx:29–44` — dismissal via `window` click + Escape; the menu div calls
  `event.stopPropagation()` at `:176` so clicks inside do not dismiss it.
- `src/components/PresetBar.css:202–213` — `.preset-menu`: `position: fixed`, `z-index: 400`,
  opaque `background: #15130f`, no opacity/transform/animation.
- `src/components/PresetBar.css:1–8` — `.preset-bar { position: relative; z-index: 2 }` → stacking
  context. `AmpPanel.css:61–68` — `.preset-rail { position: relative; z-index: 1 }` → another one.
- `src/components/AmpPanel.tsx:68, 86, 159` — `.panel-header`, `.knob-row`, `.panel-footer` are
  later-in-DOM siblings of the rail, each `position: relative; z-index: 1`
  (`AmpPanel.css:70–76, 144–154, 185–194`). They therefore paint above the entire rail subtree,
  including its z-400 child — exactly the elements visible through the menu in the screenshot.
- `src/App.css:14–24` — `.app-content { position: relative; z-index: 1; overflow: hidden }` traps
  the panel at level 1 inside `.app` (`isolation: isolate`, `App.css:1–11`). Even a larger z-index on
  the inline menu cannot beat direct `.app` children such as the tuner (z 150) or settings (z 300).
- Other preset overlays: `PresetBar.tsx:229–241` (`PresetEditor`, `PresetEditor.css:1–10`, z 460) and
  `PresetBar.tsx:243–267` (save/rename overlay, `PresetBar.css:246–255`, z 450) are also inline in
  the same subtree. All working overlays (settings, tuner popup, toast, confirm dialog, preview
  banner) are direct children of `.app` — see `App.tsx:308–375`.

### Root cause
`position: fixed` only changes the containing block, not the paint order. The menu is still painted
inside the `.preset-bar` stacking context (z 2 within `.preset-rail`, z 1 within `.amp-panel`), so
later sibling stacking contexts with the same z-index at the panel level (`.panel-header`,
`.knob-row`, `.panel-footer`) overpaint it. Its own `z-index: 400` is scoped to `.preset-bar` and
cannot escape.

### Key Decisions
1. **Portal preset overlays out of the faceplate subtree.** Render the menu into `document.body`
   with React's `createPortal`. It then participates in the top-level stacking context where z 400
   reliably covers the app, and it is no longer subject to `.amp-panel { overflow: hidden }` or any
   future transform/filter on an ancestor.
2. **Keep `position: fixed` + viewport coordinates.** `document.body` has no transformed ancestor, so
   `clientX/clientY` positioning and the existing clamps stay correct; no coordinate conversion.
   Portal to `document.body`, not to `.app` (which has `isolation: isolate`).
3. **Preserve dismissal and event behaviour.** The `window` click/Escape listeners and
   `stopPropagation()` on the menu remain; `createPortal` keeps React event bubbling through the
   `PresetBar` component tree, so the existing handlers behave as before.
4. **One change for all three overlays.** Use a small local helper (e.g. `PresetOverlay`) that wraps
   `createPortal(children, document.body)` and reuse it for the menu, the save/rename overlay and
   `PresetEditor`. Keeps z-index 400/450/460 values and avoids fixing the same bug twice.
5. **CSS untouched apart from optional hardening.** No changes needed to `.preset-menu` itself;
   remove any now-redundant `z-index` juggling only if QA confirms it. Do not touch `.preset-rail`.

### Alternative considered (rejected)
Raise `.preset-rail { z-index: 1 → 10 }` in `AmpPanel.css`. One line, but it only reorders the rail
within `.amp-panel`: the menu stays trapped in `.app-content` (z 1) below direct `.app` overlays
(tuner/status z 150, settings z 300) and remains vulnerable to clipping if an ancestor later gains a
transform. Portal is the robust fix.

### Proposed Changes

**`src/components/PresetBar.tsx`**
- Import `createPortal` from `react-dom`.
- Add a tiny `PresetOverlay` helper (or inline `createPortal(...)`) and wrap:
  - the `.preset-menu` JSX (`:171–227`);
  - the `<PresetEditor>` JSX (`:229–241`);
  - the `.preset-dialog-overlay` JSX (`:243–267`).
- Keep all state, handlers, `style={{ left, top }}` and `onClick={stopPropagation}` as-is.
- Optional accessibility hardening while touching this code: focus the first menu item when the
  menu opens and return focus to the triggering slot on close (the current code relies only on
  Escape + outside click). Keep it in a separate step so the visual fix can be verified alone.

**`src/components/PresetBar.css` / `src/components/PresetEditor.css`**
- No functional change expected; only remove any rule proven redundant by QA. Keep z-index 400/450/460.

**`.junie/plans/preset-menu-depth.md`**
- Mark delivery steps as completed as they land.

### Delivery Steps
- [x] **Step 1 — Portal the context menu.** Added a local `PresetOverlay` helper using
      `createPortal(..., document.body)` in `PresetBar.tsx`, so the menu paints in the top-level
      stacking context. `npm run build` / lint pass.
- [x] **Step 2 — Portal the two preset dialogs.** `PresetEditor` and the save/rename overlay share the
      same portal; z-index values and autofocus/Escape behaviour are unchanged.
- [ ] **Step 3 — QA + optional focus polish.** Run the manual checklist; add first-item focus / focus
      return only if it doesn't disturb the existing dismissal flow.

### Manual QA checklist
- Right-click and `⋯` on a slot: menu appears at the pointer; title, LIVE chip and knob numbers are
  fully hidden behind it — no bleed-through.
- Keyboard: ContextMenu / Shift+F10 opens the menu near the slot; Escape closes it.
- Click inside the menu (including the title area) does not dismiss; clicking elsewhere does.
- Menu near the right/bottom window edge still clamps inside the viewport (`:51–52`).
- Save As… / Rename… / Edit… still open their dialogs above the whole app, autofocus the name field
  where applicable, and Escape/outside-click still dismiss.
- Library view: preset dialogs/menu still behave (they are unmounted when `AmpPanel` is hidden).
- Regression check: settings, tuner popup, preview banner, toast and confirm dialog still layer
  correctly relative to each other.
