# Requirements

### Overview
The frameless title bar works and now follows the OS's left/right preference, but it looks unfinished. The two controls are oversized invisible hit boxes (`opacity: 0.3`, tiny 12px glyphs in 44×32px buttons), the close button turns Windows-red on hover, and the 32px strip is pure black with no identity. The rest of NAMpli is a dark Marshall-style amp faceplate with brass/gold accents (`#d4af37`, `#f0d060`), hairline borders, and uppercase letter-spaced labels. The title bar should read as part of that instrument panel rather than as a generic web title bar.

### Goals
- Give the window controls a deliberate visual style that matches the amp-faceplate aesthetic.
- Keep the OS left/right placement and button order behaviour introduced by `useWindowControlsSide`.
- Improve affordance and accessibility: visible-enough at rest, obvious on hover/focus, real hit targets, labelled buttons.
- Change only the title bar's presentation; do not alter minimize/close behaviour, window config, or the detection logic.

### Scope
**In Scope:**
- `TitleBar.tsx`: brand element, semantic button attributes, SVG cleanup.
- `TitleBar.css`: control geometry, glyph styling, hover/active/focus states, brand typography, bottom separator.
- Optional (phase 2, separate change): moving the settings/tuner icons into the bar, power-state LED.

**Out of Scope:**
- Adding a maximize/restore button (window is `resizable: false`, fixed 1200×650).
- Changing the OS-side detection hook or the Tauri command.
- Reworking the amp panel or settings UI.

# Technical Design

### Current Implementation
- `src/components/TitleBar.tsx`: two inline SVGs in a 12×12 viewBox with `strokeWidth="1.5"`; buttons are 44px wide with only a `title` tooltip, no `aria-label`, no `type="button"`.
- `src/components/TitleBar.css`: `.titlebar` is 32px tall, `#0a0a0a`, no separator; controls sit flush to the edge with no padding; buttons have `opacity: 0.3` at rest and a white wash on hover; `.titlebar-close:hover` is `rgba(232, 17, 35, 0.9)` — a Windows convention that clashes with the gold theme.
- OS side logic: `titlebar--controls-left` class puts the group first and orders buttons close→minimize; the drag region keeps `flex: 1`.
- Design language elsewhere: `.amp-panel` uses `linear-gradient(180deg, #1a1a1a, #111, #0d0d0d)`, `1px solid rgba(212,175,55,0.15)` borders and a 4px radius; `.panel-header` has a `2px solid rgba(212,175,55,0.4)` bottom rule; titles are uppercase with wide letter spacing and `#f0d060`; hover states elsewhere use `rgba(212,175,55,0.1–0.3)`.
- Neighbouring fixed UI: `SettingsIcon` at `top: 44px; right: 12px`, `TunerIcon` at `top: 88px; right: 12px`; the tuner popup is offset by `padding: 132px 12px 0 0`. Any future move of those icons must update these numbers.

### Design ideas considered

| Idea | Description | Pros | Cons |
|---|---|---|---|
| **A. Amp-faceplate controls** *(recommended)* | Small rounded "chips" with thin brass glyphs, subtle inset border, gold-tinted hover glow; close hovers to a muted brick red instead of Windows red. Add a centred, letter-spaced "NAMpli" wordmark and a hairline gold bottom rule. | Directly extends the existing design language; low risk; keeps OS-side logic untouched. | Less immediately recognisable than OS-native glyphs to some users. |
| **B. macOS traffic lights** | Two coloured circles (red close, amber minimize) at the OS-selected side. | Instantly recognisable; tidy at 32px height. | Implies macOS on Linux/Windows; with no maximize button the familiar three-dot group is incomplete (a fake "zoom" dot would be misleading). |
| **C. GNOME/Adwaita style** | Flat low-contrast symbols that gain a circular grey background on hover, close turning red. | Most congruent on GNOME; very simple CSS. | Generic; throws away the amp character. |
| **D. Progressive disclosure** | Buttons fully transparent until the pointer enters the title bar, then fade in. | Cleanest idle look. | Hurts discoverability and keyboard use; the current near-invisible state already reads as "broken". |
| **E. Integrated header bar** *(follow-up)* | Move `SettingsIcon` and `TunerIcon` into the 32px bar beside the controls, with the brand centred. | Biggest visual payoff; removes the floating icon stack; makes the strip feel intentional. | Medium scope: touches `App.tsx`, both icon CSS files, and the tuner popup offset. |
| **F. Power-state hardware detail** *(follow-up)* | A 5px LED next to the wordmark that glows gold when the amp is powered. | Ties the bar to the instrument; cheap once phase 1 exists. | Requires threading `settings.powerOn` from `App` into `TitleBar`. |

**Direction:** ship **A** now; treat **E** and **F** as an optional second pass. If you prefer B or C, say so before implementation — the plan below assumes A.

### Key Decisions
- **Keep the current structure**: same two buttons, same handlers, same `useWindowControlsSide` ordering. This is a presentation-only change.
- **Smaller controls, better targets**: 32×28px buttons with a 6px radius and 2px gaps (≈68px group) instead of two 44px blocks with 12px glyphs. Keep at least a 24px hit target per WCAG guidance; use a 12px viewBox with `strokeWidth="1.2"` for a finer, less blocky glyph.
- **Brass, not Windows red**: idle glyphs dim brass (`rgba(212,175,55,0.55)`), hover raises them to `#f0d060` with a soft gold glow; close hover uses a muted `rgba(176, 48, 40, 0.9)` with white glyph — readable as "danger" without being a Windows red block.
- **Brand is decorative**: absolutely centred in the bar with `pointer-events: none`, so the whole bar stays draggable and the brand never steals clicks.
- **Accessibility**: `type="button"`, `aria-label="Minimize"/"Close"`, `aria-hidden="true"` on the SVGs, and a `:focus-visible` brass ring. Respect `prefers-reduced-motion` by disabling transitions.
- **Side-agnostic styling**: keep `titlebar--controls-left`; add small horizontal padding on `.titlebar-controls` so chips do not hug the window corner on either side. The brand stays centred regardless of side.

### Proposed Changes

1. **`src/components/TitleBar.tsx`**
   - Add `<span className="titlebar-brand" aria-hidden="true">NAMpli</span>` inside the `.titlebar` (after the drag region; absolute positioning makes DOM order irrelevant).
   - Add `type="button"` and `aria-label` to both buttons; add `aria-hidden="true"` to their `<svg>` elements; reduce `strokeWidth` to `1.2`.
   - Keep the existing `controlsOnLeft` ordering and `titlebar--controls-left` class exactly as-is.

2. **`src/components/TitleBar.css`**
   - `.titlebar`: add `border-bottom: 1px solid rgba(212, 175, 55, 0.12)`; keep height/background/z-index.
   - `.titlebar-controls`: add `gap: 2px; padding: 0 6px;`.
   - `.titlebar-button`: `width: 32px; height: 28px; border-radius: 6px; border: 1px solid transparent; color: rgba(212,175,55,0.55); opacity: 1; transition: color/background/border/box-shadow 0.15s ease;` (remove the blanket dimming).
   - `.titlebar-button:hover`: `color: #f0d060; background: rgba(212,175,55,0.12); border-color: rgba(212,175,55,0.35); box-shadow: 0 0 8px rgba(212,175,55,0.18);`.
   - `.titlebar-button:active`: `background: rgba(212,175,55,0.2); transform: translateY(1px);`.
   - `.titlebar-close:hover`: override with muted brick red background/border and white glyph; matching `:active` darker shade.
   - `.titlebar-button:focus-visible`: `outline: 1px solid rgba(212,175,55,0.9); outline-offset: -2px;`.
   - `.titlebar-brand`: absolute, centred, `font-size: 0.62rem; font-weight: 700; letter-spacing: 0.35em; text-transform: uppercase; color: rgba(212,175,55,0.45); pointer-events: none; user-select: none;`.
   - `@media (prefers-reduced-motion: reduce)`: remove transitions/transform on the buttons.

3. **No changes to**: `App.css`, `App.tsx`, `tauri.conf.json`, `useWindowControlsSide.ts`, the Rust detector, or the Tauri capabilities.

### Optional phase 2 (separate change, not in these steps)
- Move `SettingsIcon` and `TunerIcon` into the bar, update their CSS from `position: fixed` to flow items, and adjust `.tuner-popup-overlay { padding: 132px ... }` accordingly.
- Thread `settings.powerOn` into `TitleBar` for the LED and reuse the existing `.amp-panel.power-on` glow colour.

# Delivery Steps

### Step 1: Restructure the title bar markup
Add the centred brand span and the accessibility attributes in `TitleBar.tsx`, keeping button order and handlers untouched.

### Step 2: Restyle controls and bar
Apply the amp-faceplate styling in `TitleBar.css`: separator, chip geometry, brass glyphs, hover/active/focus states, muted close hover, brand typography, reduced-motion guard.

### Step 3: Verify both OS sides and the browser fallback
With this machine's `close,minimize:appmenu`, confirm the group sits on the left, close first, with the brand centred; temporarily switch to `appmenu:minimize,maximize,close` to confirm the right-side layout, then restore the original setting. Check `npm run dev` (plain browser) renders the right-side default cleanly.

### Step 4: Build and lint
Run `npm run build` and `npm run lint`; confirm no new warnings (the existing `SettingsPanel.tsx` exhaustive-deps warning is pre-existing). No Rust changes are needed, so `cargo test` is unaffected.
