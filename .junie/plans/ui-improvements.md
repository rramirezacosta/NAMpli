# UI improvement plan for NAMpli

# Requirements

### Overview
The app is a fixed 1200×650 Tauri window (`src-tauri/tauri.conf.json:16-18`) with a brass-on-black
amp-faceplate aesthetic. The current screen (see attached screenshot) works, but it has several
visible problems: the brand appears twice, the preset board is visually secondary to a decorative
title, the knobs carry dense low-contrast micro-copy, the power switch floats in empty space, and
roughly a quarter of the window is unused dead space. Settings/tuner are unlabeled icons pinned to
the canvas with magic offsets, and the dialogs each use a slightly different visual language.

This plan is **presentation-only**: it reorganizes layout, hierarchy, typography and interaction
feedback without changing audio, preset data, or backend behaviour.

### Goals
1. One clear visual hierarchy: **presets → model/IR state → knobs → power/status**.
2. Fill the 1200×650 viewport deliberately; no scrollbar, no large empty regions, no clipped text.
3. Keep the existing brass/black "amp faceplate" identity (do not restyle into a generic web UI).
4. Make state legible at a glance: powered / bypass / model+IR loaded / unsaved changes.
5. Make every control discoverable and keyboard-accessible; unify overlays and dialogs.
6. Introduce shared design tokens so future UI work stops hardcoding `#d4af37` in 12 CSS files.

### In Scope
- `src/index.css` — design tokens (`:root` custom properties) and global focus/reduced-motion rules.
- `src/App.css`, `src/App.tsx` — viewport-filling layout, vertical centering, icon placement,
  tuner-popup anchoring, confirmation dialog styling.
- `src/components/AmpPanel.tsx` / `.css` — header, preset rail, knob sections, power/status strip.
- `src/components/Knob.tsx` / `.css` — keyboard support, tooltip/caption cleanup, focus ring.
- `src/components/PresetBar.tsx` / `.css` — visible slot-menu affordance, clearer active/dirty states.
- `src/components/PowerSwitch.tsx` / `.css` — integrated power rail with explicit state labels.
- `src/components/TitleBar.tsx` / `.css` — single wordmark, optional home for the utility icons.
- `src/components/SettingsIcon.css`, `TunerIcon.css`, `AudioStatusBar.css`, `Toast.css`,
  `SettingsPanel.css`, `PresetLibrary.css`, `Tuner.css` — token migration and consistency.

### Out of Scope
- Audio engine, DSP, tuner algorithm, preset schema, Tauri commands, asset/library logic.
- Changing the fixed 1200×650 window size or adding resizability (kept as an open question).
- Renaming or moving preset features (Save / Save As / Rename / Delete / A/B / Library) — only their
  presentation and discoverability change.
- Reintroducing the removed `Logo`/`InputJacks` components; `Logo.tsx` stays unused.

### Target layout (1200×650, ASCII sketch)
```
┌──────────────────────────────────────────────────────────────────────┐
│  —   ×                      NAMpli                       ⚙   ♩      │ 32px titlebar
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   ┌──────────────────────────────────────────────────────────────┐   │
│   │ [A|B]  [1][2][3][4]        Save   A/B   Library             │   │ preset rail
│   ├──────────────────────────────────────────────────────────────┤   │
│   │                    N A M P L I                              │   │ brand (one)
│   │        JCM800 2203   ·   IR: Mesa 4x12          [● LIVE]    │   │ state readout
│   │  ┌────────────┬───────────────────────┬──────────────────┐   │   │
│   │  │ INPUT GATE │ BASS MIDDLE TREBLE    │ OUTPUT           │   │   │ knob sections
│   │  └────────────┴───────────────────────┴──────────────────┘   │   │
│   ├──────────────────────────────────────────────────────────────┤   │
│   │  ⏻  STANDBY / ON   ●        BYPASS · NO CAB IN              │   │ power/state strip
│   └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ●  48.0 kHz · 5.3 ms · 0 xruns      NAM: gain5.nam   IR: ...        │ status bar
└──────────────────────────────────────────────────────────────────────┘
```
- Panel width grows from 900px to ~1040px (`max-width: min(1040px, calc(100vw - 120px))`) so the
  side gutters shrink; `app-content` uses the same cap.
- Content block is vertically centered in the space below the titlebar with `overflow: hidden`;
  remove `padding-top: calc(32px + 2rem)` and the scrollbar (`src/App.css:10-23`).
- The power switch stops floating (`App.tsx:304-306`) and becomes the panel's footer strip.
- Utility icons move into the titlebar's right cluster (or, if kept on canvas, get text labels);
  the tuner popup is then anchored with a single `top: 40px` rule instead of
  `padding: 132px 12px 0 0` (`src/App.css:34-43`).

### UX behaviour
- **Branding:** keep the decorative wordmark in the titlebar *or* the big panel title, not both.
  Preferred: drop the titlebar wordmark (`TitleBar.tsx:67`) and keep the panel title; the OS window
  title already carries "NAMpli".
- **Model/IR readout:** replace the letter-spaced uppercase subtitle
  (`AmpPanel.tsx:47-50`, `AmpPanel.css:84-91`) with a compact status line:
  `MODEL: <name> · IR: <name>`, ellipsized with `title` for full names, plus a small `BYPASS` /
  `LIVE` pill driven by `modelName`, `irName` and `powerOn`.
- **Presets:** promote the preset bank/slots/actions to a full-width rail at the top of the panel,
  visually separated from the brand. Active slot keeps the gold outline; the dirty dot gets a
  tooltip ("Unsaved changes") and is suppressed when the app is not powered only if that matches
  current semantics (keep current logic — do not change behaviour).
- **Slot menu:** right-click still works, but add a small `⋯` button that appears on hover/focus and
  opens the same menu, plus support the keyboard `ContextMenu` key. This makes Save/Rename/Delete
  discoverable without a manual.
- **Knobs:** keep the 100px knob and 0–10 scale; replace the always-visible 2–3 line italic captions
  (`Knob.css:162-170`) with one of: a single-line caption (preferred, e.g. "Drive into model") or a
  hover/focus tooltip driven by the existing `title`/`description` prop. Show the numeric value
  prominently and keep it tabular.
- **Power:** one canonical label pair (`STANDBY` / `ON`) used by the power button, the LED tooltip
  and the status bar; add `aria-label` that states the resulting action
  ("Power on" / "Power off"). Never show contradictory "Standby" text next to a lit LED.
- **Overlays:** Settings, Preset Library, Tuner and the NAM confirmation dialog share one visual
  language: backdrop, centered card, consistent header/close button, `role="dialog"`,
  `aria-modal="true"`, Escape to close, focus moved into the dialog and restored on close.

### Accessibility and interaction fixes
- `Knob.tsx:131-142` declares `role="slider"` and `tabIndex` but has no keyboard handler. Add
  ArrowUp/ArrowRight = +1, ArrowDown/ArrowLeft = −1, PageUp/PageDown = ±2, Home = 0, End = 10,
  with `preventDefault()`, plus `aria-valuetext={`${label} ${value}`}` and a `:focus-visible` ring
  on `.knob-body` (`Knob.css:45-64`).
- Add `:focus-visible` outlines to all buttons/inputs via a global rule in `index.css`; do not rely
  on hover-only styling.
- Add `aria-haspopup="menu"` / `aria-expanded` to preset slot triggers; close menus on blur as well
  as window click (`PresetBar.tsx:27-42`).
- Keep `@media (prefers-reduced-motion: reduce)` coverage for the new transitions (TitleBar already
  has one at `TitleBar.css:105-113`).

# Technical Design

### Current implementation (relevant lines)
- `src/index.css:1-21` — reset only; no tokens, no focus or motion rules.
- `src/App.css:10-23` — `.app-content` is a scrollable `max-width: 1000px` column with a large top
  padding; `.controls-row` floats the power switch.
- `src/components/AmpPanel.css:1-116` — panel `max-width: 900px`; header is a centered title group
  with a 2px gold rule; three `.knob-group` boxes; texture via `::before`.
- `src/components/Knob.tsx:29-43` — click-to-position plus vertical drag; no keyboard path.
- `src/components/Knob.css:124-170` — indicator, label/value, long italic description.
- `src/components/PresetBar.css:1-154` — bank toggle, 4×112px slots, stacked action buttons.
- `src/components/PowerSwitch.css:8-92` — standalone button + LED.
- `src/components/SettingsIcon.css:1-17` / `TunerIcon.css` — `position: fixed` with `top: 44px`.
- `src/components/AudioStatusBar.css:1-14` — tiny 0.66rem gray text pinned bottom-left.
- Colors are repeated as literals (`#d4af37`, `#f0d060`, `rgba(212,175,55,...)`, `#0a0a0a`) across
  essentially every component stylesheet.

### Key decisions
1. **CSS-only refactor first, structural JSX second.** Tokens and layout can be introduced without
   touching `useRigState`/`usePresetManager`; component markup changes are limited to the list above.
2. **Keep the skeuomorphic theme.** Gold accents, inset highlights, panel texture and knobs stay;
   the improvements are spacing, scale, contrast and hierarchy, not a visual rebrand.
3. **One source of truth for state.** Power/model/IR state stays in `rig`/`audioStatus`; no new
   duplicated React state is added just for display. Derived badges read the existing props.
4. **No new dependencies.** Plain CSS custom properties and existing SVG icons; no UI kit.
5. **Backwards-compatible props.** `Knob`, `PresetBar`, `PowerSwitch` keep their current prop
   signatures so `App.tsx` wiring and tests/consumers do not break.
6. **Fixed-window assumptions stay.** All sizing uses the 1200×650 baseline with `min()`/`clamp()`
   guards so OS scaling or a later resizable window cannot clip the UI.

### Proposed tokens (`src/index.css`)
```css
:root {
  --bg-app: #0a0a0a;
  --bg-panel: #141414;
  --bg-elevated: #1c1c1c;
  --gold: #d4af37;
  --gold-bright: #f0d060;
  --gold-soft: rgba(212, 175, 55, 0.12);
  --gold-line: rgba(212, 175, 55, 0.25);
  --text: #e8e2d4;
  --text-muted: #a89b80;
  --text-dim: #7a7266;
  --ok: #6fdd8b;
  --danger: #d98a7a;
  --radius: 6px;
  --panel-max: 1040px;
}
```
Migrate one stylesheet per phase; keep literal values only where a gradient needs a unique stop.

### File-by-file work
- **`index.css`** — add tokens, global `:focus-visible`, `button { font: inherit }`, reduced-motion.
- **`App.css`** — use flex column with `.app-content` centered and `overflow: hidden`; status bar
  reserved space at bottom; tuner popup anchored to the titlebar; one shared overlay/card style.
- **`AmpPanel.tsx/.css`** — reorder DOM into: preset rail → brand + state readout → knob sections →
  power/state strip. Widen panel, reduce header border weight, add section labels
  (`INPUT / GATE`, `EQ`, `OUTPUT`) above the knob groups; use tokens throughout.
- **`Knob.tsx/.css`** — keyboard handler, `aria-valuetext`, focus ring, one-line caption or tooltip,
  slightly brighter tick numbers, brighter value readout.
- **`PresetBar.tsx/.css`** — `⋯` affordance, aria attributes, clearer active/empty/dirty styling;
  action buttons laid out in a row with min 44px hit targets.
- **`PowerSwitch.tsx/.css`** — restyle as a wide footer control with status text; keep LED; add
  action-oriented `aria-label`.
- **`TitleBar.tsx/.css`** — remove decorative wordmark (preferred) or utility icons; if icons move
  here, turn `.settings-icon`/`.tuner-icon` from `position: fixed` into inline flex buttons.
- **`AudioStatusBar.css`** — slightly larger (0.7–0.72rem), brighter muted color, separator between
  sections, long IR names ellipsized with a fixed max width.
- **`Toast.css`, `SettingsPanel.css`, `PresetLibrary.css`, `Tuner.css`** — adopt tokens, consistent
  card headers, close buttons and spacing; no behaviour changes.

# Implementation phases

### Phase 0 — Tokens and baseline (small, mechanical)
- [ ] Add `:root` tokens, focus-visible and reduced-motion rules to `index.css`.
- [ ] Replace hardcoded colors with tokens in `App.css` and `AmpPanel.css`.
- [ ] Capture a before screenshot at 1200×650 for comparison.

### Phase 1 — Layout and hierarchy (biggest visual win)
- [ ] Restructure `App.css` to fill the viewport, remove scroll and center the content block.
- [ ] Reorder `AmpPanel` into preset rail / brand+state / knobs / power strip.
- [ ] Move power switch into the panel footer; remove `.controls-row` from `App.tsx`.
- [ ] Widen the panel to 1040px with a `min()` guard; verify no overlap with utility icons.
- [ ] Consolidate branding to one wordmark and adjust the titlebar/utility-icon placement.

### Phase 2 — Legibility and state
- [ ] Replace the decorative subtitle with a `MODEL / IR` readout and BYPASS/LIVE pill.
- [ ] Simplify knob descriptions to one line or hover/focus tooltips; bump value/tick contrast.
- [ ] Add section labels above the three knob groups.
- [ ] Standardize power/standby wording across panel, button and status bar.
- [ ] Improve `AudioStatusBar` sizing/contrast.

### Phase 3 — Accessibility and interaction
- [ ] Full keyboard support for `Knob` (arrows, PageUp/Down, Home/End) with aria updates.
- [ ] Visible `⋯` slot-menu trigger + `ContextMenu` key + aria menu attributes.
- [ ] Dialog focus management for Settings, Library, Tuner and NAM confirmation; Escape everywhere.
- [ ] Global `:focus-visible` verification across all interactive elements.

### Phase 4 — Consistency polish
- [ ] Migrate remaining component stylesheets to tokens.
- [ ] Unify overlay/card/close-button styles; tune toasts.
- [ ] Re-anchor the tuner popup to the titlebar and verify at 1200×650.
- [ ] Final reduced-motion and contrast pass.

# Verification
- [ ] `npm run build` and `npm run lint` pass.
- [ ] Browser and `npm run tauri dev` screenshots at 1200×650 compared with the baseline.
- [ ] No scrollbars, no overlapping/ellipsized-beyond-recognition text, power switch inside panel.
- [ ] Keyboard-only walkthrough: Tab order is sensible; knobs respond to all keys; Escape closes
      Settings, Library, Tuner and NAM confirmation; focus returns to the opener.
- [ ] Preset flows unchanged: recall, save, dirty dot, A/B compare, Library import/export.
- [ ] Tuner popup opens/closes correctly with the new icon placement; status bar reads correctly in
      standby and powered states.
- [ ] OS scaling smoke test (100% and 125%) to ensure the `min()` guards prevent clipping.

# Risks / mitigations
- **Token migration is wide.** Do it per phase with visual diffs; a missed literal is cosmetic, not
  functional.
- **Moving utility icons into the titlebar** changes fixed positioning and popup anchoring; handle
  both in the same phase and verify immediately.
- **Wider panel** can collide with floating icons on scaled displays; keep the `calc(100vw - 120px)`
  cap and test 125% scaling.
- **Knob keyboard handling** must not conflict with vertical-drag pointer logic; share the same
  clamp/round helper (`Knob.tsx:29-43`) and call `onChange` once per key.

# Open questions
1. Keep the skeuomorphic brass/amp look (assumed here), or move toward a flatter modern console?
2. Should knob explanations become hover/focus tooltips, or stay as always-visible one-line captions?
3. Should Settings/Tuner icons move into the titlebar (recommended), or stay on canvas with labels?
4. Keep the window fixed at 1200×650, or make it resizable as part of this work?

# Status (2026-11-19)
- [x] Phases 0–4 implemented: tokens, viewport layout, panel restructure, legibility, keyboard/menu
      accessibility, dialog focus management, and overlay/style consistency.
- [x] `npm run build` and `npm run lint` pass (one pre-existing `selectedHost` exhaustive-deps warning
      in `SettingsPanel.tsx` remains).
- [x] Rendered at 1200×650 in a headless browser and compared with the baseline: no scrollbar,
      panel centered, preset rail/readout/power strip all visible and unclipped.
- [ ] Interactive keyboard/Tauri QA (preset recall, A/B, dialogs, tuner popup) still recommended in
      the native app before release.
