# UI polish plan — faceplate, Library and Tuner

> **Status: Draft — no work started.**
> This is the follow-up to `ui-improvements.md` (already implemented and marked done). It covers the
> UI as it exists today: three full-window views, the preset editor, the asset library and the two
> level meters. It is **presentation and interaction polish only** — no audio, preset-schema or
> backend changes.

# Requirements

## Overview

The app is a fixed 1200×650 Tauri window (`src-tauri/tauri.conf.json:13-21`) with a brass-on-black
amp-faceplate identity. Three views share one shell (`src/App.tsx:41`, `:336-453`): the amp
faceplate (default), the full-window asset Library and the full-window Tuner. A fixed top-right tool
cluster (`App.css:70-116`) and a bottom-left status bar (`AudioStatusBar.tsx:16-27`) persist across
all views, plus a preview banner, toasts and several dialogs.

The features are in place and the old UI plan's tokens/layout work is done. What remains is
**fit and finish**: one view header collides with the toolbar, state is described in four different
vocabularies, the amp panel leaves ~100px of dead space top and bottom, overlays repeat the same
card/button CSS five times with inconsistent z-indexes, and several small interaction details
(the Enter-to-keep hint, the hidden `⋯` trigger, the empty-slot Save hint) contradict what the app
actually does.

## Goals

1. **P0 — No collisions or clipped controls.** The floating tool cluster is mounted only on the amp
   faceplate, so it cannot sit over a full-window view's header; footers still clear the status bar
   at 1200×650 and 125% OS scaling.
2. **P0 — One state language.** `STANDBY / BYPASS / ACTIVE` means the same thing on the faceplate,
   status bar and tuner; loaded vs previewed vs selected is distinguishable at a glance.
3. **P1 — Deliberate use of the viewport.** Reduce the empty bands around the faceplate and tuner
   without scrolling or shrinking hit targets.
4. **P1 — Shared visual primitives.** Existing tokens (`index.css:7-34`) are actually used; one
   documented set of overlay/card/button/back-button/close-button rules replaces five copies.
5. **P1 — Keyboard and ARIA parity.** Dialogs trap and restore focus, menus are navigable, visible
   focus rings are never removed, and every status cue has a text alternative.
6. **P2 — Remove dead/conflicting code** so future UI work has one path per action.

## In scope

- `src/index.css` — expand tokens (geometry, overlay, type scale, z-index scale), keep global focus
  and reduced-motion rules.
- `src/App.css` — shared shell primitives, chrome reservations, overlay/z-index normalization.
- `src/components/AmpPanel.tsx` / `.css` — state pill variants, readout, footer hints, vertical rhythm.
- `src/components/PresetBar.tsx` / `.css` — slot/menu affordances, active vs preview vs selected,
  dirty label, dialog focus.
- `src/components/AssetLibrary.tsx` / `.css` — header/footer chrome reservations, `aria-sort` /
  `aria-current`, focus ring, back-button primitive.
- `src/components/Tuner.tsx` / `.css` — power wording, scale-up into the available height, footer reservation.
- `src/components/LevelMeter.tsx` / `.css` — idle readout, clip state, tick legibility.
- `src/components/PresetEditor.tsx` / `.css`, `SettingsPanel.css`, `Toast.css`, `AudioStatusBar.tsx` /
  `.css` — shared primitives and state wording.
- `src/App.tsx` — Enter-to-keep precedence, stale trigger attribute rename, optional shared helpers.

## Out of scope

- Audio engine, DSP (including the just-added de-click guard), NAM/IR logic, tuner algorithm,
  preset schema, Tauri commands and asset storage.
- Changing view structure (three full-window views stay), preset features, or the fixed 1200×650
  window size.
- Replacing `window.confirm` with themed dialogs **in this pass** — listed as an open question; if
  accepted, it becomes a small follow-up phase.
- Reintroducing `Logo`/`InputJacks` or restyling into a flat, non-skeuomorphic console.

## Current state (verified)

| Area | Today |
| --- | --- |
| Shell | `.app` / `#root` pin to `100vh` with `overflow: hidden`; `.app-content` centers its view with 12px padding (`index.css:36-50`, `App.css:1-24`). |
| Tools | Fixed `.window-tools` at `top: .5rem; right: 1rem`, z400; three 28×26 icon buttons (`App.css:70-116`). |
| Faceplate | Panel `width: min(1040px, calc(100vw - 120px))`, ~400–440px tall, centered in ~626px (`AmpPanel.css:1-15, 61-76, 84-154, 185-194`). |
| Library | Header has **no** right reservation (`AssetLibrary.css:15-22`); its Cleanup/Import buttons sit under the fixed toolbar. Footer has no bottom reservation (`:359-368`). |
| Tuner | Header reserves `padding-right: 84px` (`Tuner.css:20-28`); footer reserves `padding-bottom: 1.9rem` (`:286-297`). These are the patterns to copy. |
| Tokens | Defined at `index.css:7-34`; colors are still hardcoded in every component stylesheet. |
| State | `AmpPanel.tsx:54-57` derives `standby/live/bypass`; `.state-pill.bypass` has no CSS (`AmpPanel.css:121-142`). Tuner uses `Live` for *powered* (`Tuner.tsx:58-61`), faceplate `LIVE` for *model loaded* — contradictory. |
| Preview | Shared banner (`App.tsx:351-367`) + library badges (`AssetLibrary.tsx:100-101, 255, 267-268`); the faceplate itself has no audition marker. |
| Dialogs | `useDialogFocus` is used only by Settings (`SettingsPanel.tsx:47`) and the NAM confirm (`App.tsx:179`); preset dialog and editor use `autoFocus` + window Escape only (`PresetBar.tsx:270-294`, `PresetEditor.tsx:175-241`). |
| Menu | `⋯` trigger is `opacity: 0` until hover/focus and only 20×20px (`PresetBar.css:139-169`); menu has no arrow-key navigation. |
| ARIA gaps | No `aria-sort` on library headers (`AssetLibrary.tsx:240-245`); no `aria-current` on rows (`:252-255`); library search removes its focus outline (`AssetLibrary.css:69-72`); dirty dot is title-only (`PresetBar.tsx:174`). |
| Dead code | `Logo.tsx/.css` unreferenced; unused manager exports (`usePresetManager.ts:159, 350-475, 490-503`); unused `AssetLibrary.css:295-311`; stale `data-preset-library-trigger` naming. |

# Target design

## View shell (all three views)

```
┌──────────────────────────────────────────────────────────────────────┐
│ native titlebar                              [📁][⚙][♩]  ← tools   │  fixed, z400
├──────────────────────────────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────────────────────────────┐ │
│ │ header     title / search / filters / actions                  │ │
│ │ body       …                                                    │ │
│ │ footer     …                                ← status-bar reserve│ │
│ └──────────────────────────────────────────────────────────────────┘ │
│  ● 48.0 kHz · 5.3 ms · 0 xruns      NAM: …  IR: …   ← status bar   │  fixed, left
└──────────────────────────────────────────────────────────────────────┘
```

- The top-right tool cluster renders only when `view === 'amp'` (`App.tsx`); full-window Library and
  Tuner headers use their full width. One `--chrome-reserve-bottom: 1.9rem` keeps footers clear of
  the persistent status bar.
- One `.view-shell` class (panel background, border, radius, shadow) shared by `.amp-panel`,
  `.asset-library` and `.tuner`.
- One z-index scale in `index.css`, e.g. content 1 → local overlays 10 → settings 20 → tools 30 →
  preview banner 40 → modal overlay 50 → toast/drop 60.

## Faceplate state strip

```
[A|B]  [1][2][3][4]            ⋯ per slot       preset rail
             N A M P L I
   ● ACTIVE   MODEL: JCM800   ·   IR: Mesa 4x12     readout
   PREVIEW chip appears here only during an audition
  IN │ Input/Gate │ Equalizer │ Output │ OUT       knobs + meters
  ⏻ STANDBY/ON     CAB ON   ·   Drop .nam/.wav/.json   footer
```

- Badge vocabulary: `STANDBY` (power off), `BYPASS` (powered, no model), `ACTIVE` (model loaded).
  A separate gold `PREVIEW` chip appears during an audition; the slot's `.active` styling then means
  "recalled", not "committed".
- `.bypass` gets an amber style distinct from `.standby` (gold) and `.active` (green).
- `AudioStatusBar` shows both `NAM: <name>` and `Cab: <name>`, each ellipsized.

# Work areas

## A. Chrome collisions and geometry (P0)

1. Mount `.window-tools` only on the amp view (`App.tsx:344-348`) so the Library/Tuner headers own
   the full width. Keep one `--chrome-reserve-bottom` token for both full-window footers
   (`AssetLibrary.css:359-368`, `Tuner.css:286-297`).
2. Extract `.view-shell` from the three duplicated panel rules (`AmpPanel.css:1-15`,
   `AssetLibrary.css:2-13`, `Tuner.css:2-14`).
3. Capture before/after screenshots of the Library header at 1200×650 and at 125% scaling to prove
   Import/Cleanup are fully visible and clickable.
4. Add a narrow-viewport fallback (`@media (max-width: 1100px)`) allowing `.knob-row` to wrap or
   scale (`AmpPanel.css:144-154`) — relevant in browser dev mode, where the window is resizable.

## B. State language and legibility (P0/P1)

1. Rename the faceplate pill values to `STANDBY / BYPASS / ACTIVE` (`AmpPanel.tsx:54-57`) and add
   `.state-pill.bypass` (`AmpPanel.css:121-142`); keep `title` as the full sentence.
2. Use `POWER ON / STANDBY` on the tuner (`Tuner.tsx:58-61`) so "Live" no longer means two things.
3. Show `NAM:` as well as `Cab:` in `AudioStatusBar.tsx:17-26` (`status.namModel` already exists,
   `tauri.ts:101`) with a shared ellipsis helper.
4. Add a `PREVIEW` chip to the faceplate readout when `presetManager.preview` or `assetPreview` is
   active; keep the existing banner as the primary control.
5. Give the dirty dot an accessible name (`role="status"` + visually-hidden text, or `aria-label`)
   at `PresetBar.tsx:173-175` and a tooltip that explains what Save does.
6. Correct two contradictory hints: empty slot → `… then use ⋯ → Save here` (`PresetBar.tsx:164`);
   drop hint → include `.json` and point to the Library (`AmpPanel.tsx:163`).
7. Level meters: show `—` instead of `0.0` when there is no reading (`LevelMeter.tsx:29-31, 77-80`),
   expose clip state in `aria-valuetext` instead of title-only (`:75`), and raise the 0.45rem tick
   labels (`LevelMeter.css:52-57`) to a legible minimum.

## C. Shared visual primitives and tokens (P1)

1. Add tokens to `index.css:7-34`: `--overlay-bg`, `--card-bg`, `--card-border`, `--shadow-card`,
   type sizes (`--fs-xs … --fs-xl`), spacing (`--space-1 … --space-4`) and the z-index scale.
2. Define reusable rules in `App.css` (or a small `src/styles/ui.css`): `.overlay`, `.card`, `.btn`,
   `.btn-primary`, `.btn-ghost`, `.close-btn`, `.back-btn`, `.section-title`. Migrate, in order:
   NAM confirm (`App.css:152-244`), preset dialog (`PresetBar.css:215-284`), preset editor
   (`PresetEditor.css:1-24, 141-168`), settings (`SettingsPanel.css:1-58`), toast (`Toast.css:66-75`).
3. Replace the two near-identical back buttons (`AssetLibrary.css:52-54` + `:33-44`,
   `Tuner.css:30-47`) with `.back-btn`.
4. Replace hardcoded `rgba(212,175,55,…)` / green / rust literals with tokens; keep unique gradient
   stops literal. Normalize `font-family: inherit` vs `font: inherit` on buttons and inputs.
5. Normalize stacking: render the portaled preset menu/dialogs (`PresetBar.tsx:34-36`) into a single
   overlay root inside `.app` so their numbers follow the shared scale instead of silently
   outranking the z600 NAM confirm.

## D. Interaction and accessibility (P1)

1. Fix Enter-to-keep: the banner promises it (`App.tsx:355`) but the global handler bails out for a
   focused `BUTTON` (`:199-205`), so clicking a slot leaves focus there and Enter re-recalls. Check
   an active preview *before* the focused-control bail-out.
2. Apply `useDialogFocus` to the preset dialog (`PresetBar.tsx:270-294`) and `PresetEditor`
   (`PresetEditor.tsx:175-241`); keep the existing Settings/NAM-confirm usage.
3. Make the `⋯` trigger always visible at low opacity and ≥24×24px (`PresetBar.css:139-169`), and
   add arrow-key navigation + initial focus to `role="menu"` (`PresetBar.tsx:196-259`).
4. Restore a `:focus-visible` gold ring on the library search (`AssetLibrary.css:69-72`).
5. Add `aria-sort` to sortable headers (`AssetLibrary.tsx:240-245`) and `aria-current` / `aria-pressed`
   to loaded / previewed / selected rows (`:252-255`).
6. Add `aria-valuetext` units and `aria-orientation="vertical"` to knobs (`Knob.tsx:173-191`) and
   raise tool-button / tuner ± / close-button hit targets to ≥28px (`App.css:81-86`,
   `Tuner.css:68-69`, `Toast.css:66-75`).
7. Add section landmarks/labels where a bare `aria-label` sits on a `div` (`PresetBar.tsx:131`,
   `AssetLibrary.tsx:217`) and wire `aria-labelledby="asset-library-title"` (`AssetLibrary.tsx:204-207`).

## E. Cleanup (P2)

1. Delete unreferenced `Logo.tsx` / `Logo.css`.
2. Remove unused CSS (`AssetLibrary.css:295-311`) and unused manager exports after a grep confirms
   no consumers (`usePresetManager.ts:159, 350-475, 490-503`; `PresetEditorProps.onSaved` at
   `PresetEditor.tsx:23, 142`).
3. Rename the stale `data-preset-library-trigger` to `data-library-trigger` in **both**
   `LibraryIcon.tsx:10` and `App.tsx:58`; rename `librarySelection` → `assetSelection` for clarity.
4. Factor shared helpers for `isTauri()` (`App.tsx:30`, `main.tsx:9`) and path basename parsing
   (`App.tsx:120-121`, `AssetLibrary.tsx:192-193`, `PresetEditor.tsx:112`).
5. De-duplicate the initial asset load in `useAssetLibrary.ts:29-53` and the "Nothing to clean up"
   notice (`App.tsx:91`, `useAssetLibrary.ts:233-234`).

# Implementation phases

Each phase should be visually verifiable on its own. No phase changes audio or preset data.

- [x] **Phase 0 — Baseline.** Recorded the current `tsc` / `lint` / `build` result (lint had one
      pre-existing `SettingsPanel.tsx:60` warning). No browser driver is installed in this
      environment, so screenshots were not captured — manual QA is listed below.
- [x] **Phase 1 — Chrome and geometry** (work area A). Tool cluster mounted only on the amp view,
      bottom chrome reserve token, `.view-shell`, narrow-viewport fallback and a slightly taller
      faceplate/tuner rhythm.
- [x] **Phase 2 — State legibility** (work area B). `STANDBY / BYPASS / ACTIVE / PREVIEW` badges,
      tuner `Power on`, status-bar NAM + IR, corrected hints, meter idle/clip/ticks.
- [x] **Phase 3 — Primitives and tokens** (work area C). Tokens, `.overlay/.card/.btn/.close-btn/
      .back-btn/.section-title`, one z-index scale, portals moved inside `.app`.
- [x] **Phase 4 — Accessibility** (work area D). Enter-to-keep precedence, dialog focus, menu arrow
      navigation, visible `⋯`, restored search focus ring, ARIA sort/current/slider/meter updates.
- [x] **Phase 5 — Cleanup** (work area E). Removed `Logo`, unused manager exports and CSS, renamed
      the stale Library trigger state, shared `isTauri` / `fileNameFromPath`, de-duplicated the asset
      load and cleanup notice.

# Verification

There is no frontend test runner (`package.json:6-12`), so verification is build + lint + manual QA:

1. `npx tsc --noEmit`, `npm run lint`, `npm run build` after every phase.
2. `npm run tauri dev` at 1200×650 (and `npm run dev` in a browser at 1100px for the fallback):
   - Library header buttons are fully visible and clickable; footers clear the status bar.
   - Faceplate states `STANDBY / BYPASS / ACTIVE / PREVIEW` are visually distinct; status bar shows
     both NAM and IR; meters show `—` when idle.
   - All overlays use the same card/button language; the NAM confirm is never hidden behind a
     portaled preset dialog.
3. Keyboard-only pass: Tab order is sensible; knobs respond to arrows/Page/Home/End; `⋯` is reachable
   and its menu navigable by arrows; Enter keeps an audition even right after clicking a slot;
   Escape closes Settings, preset dialog, editor and NAM confirm and restores focus.
4. Preset Library QA unchanged: search, filters, sort indicators, preview/keep/revert, import,
   export, rename, delete, cleanup.
5. OS scaling smoke test at 100% and 125%.

# Risks / mitigations

- **Wide token migration.** Do one stylesheet per phase; a missed literal is cosmetic, not functional.
- **Portal/z-index changes** can make a dialog disappear behind another overlay. Change the stacking
  model in one commit and immediately exercise every overlay combination (preset dialog over menu,
  NAM confirm over drop overlay).
- **Enter-to-keep fix** interacts with the library's Enter-to-preview and slot re-recall. Keep the
  precedence: active preview → focused control → library selection preview, and test all three.
- **Vertical scale-up** can clip the `nowrap` knob row. Keep the `min()` width guards and verify at
  125% scaling before increasing knob size.
- **Cleanup of unused exports** must follow a grep across `src/`, not an assumption — several are
  part of the public `PresetManager` shape consumed via `useMemo` in `App.tsx`.

# Open questions (recommendations in bold)

1. Make the window resizable? **No** — keep 1200×650 and add only the narrow-viewport fallback.
2. Where do the tools live in full-window views? **Resolved: hide them there** (mount only on the
   amp view) — the alternative was a fixed cluster with a right-side header reserve, which still
   left icons floating over the panel header. Moving them into each view header was rejected as
   churn for a small gain.
3. Replace `window.confirm` with themed dialogs? **Yes, as a separate follow-up** — it is a behaviour
   change (focus/keyboard semantics) and deserves its own QA pass.
4. Faceplate badge wording: **STANDBY / BYPASS / ACTIVE** (recommended) vs keeping `LIVE` and
   renaming the tuner's badge only.
5. Should `⋯` be always visible at low opacity (recommended) or only on hover/focus with a larger
   touch-friendly target? The former is more discoverable; the latter is cleaner visually.

# Status

- [x] Approved and implemented. `npx tsc --noEmit`, `npm run lint` (one pre-existing
      `SettingsPanel.tsx:60` exhaustive-deps warning) and `npm run build` all pass.
- [ ] **Manual QA still required** in `npm run tauri dev`: screenshots at 1200×650 and 125% scaling,
      no tool icons over the Library/Tuner headers, all badge states, overlay stacking combinations,
      and the keyboard-only walkthrough (Tab order, menu arrows, Enter-to-keep, Escape + focus restore).
- [ ] `window.confirm` replacement remains an open decision — deliberately not part of this pass.
