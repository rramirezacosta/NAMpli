---
sessionId: session-261119-162439-hkig
---

# Requirements

### Overview
Replace the native OS title bar with a custom, seamless, minimal title bar that blends into the NAMpli app's dark aesthetic. The app already has a `TitleBar` component, but it's unused, over-styled, and its window controls don't work.

### Goals
- Remove the native OS window decorations (title bar, traffic lights, close/minimize buttons).
- Provide a custom title bar that is visually minimal: no heavy gradients, no gold accents, no shadows.
- Make the title bar functional: draggable region for moving the window, working minimize and close buttons.
- Ensure all existing fixed-position UI elements (SettingsIcon, TunerIcon, AudioStatusBar, Toast) don't overlap with the new title bar.

### Scope
**In Scope:**
- Tauri window config change (`decorations: false`).
- Redesign `TitleBar.tsx` and `TitleBar.css` to be minimal and functional.
- Wire up Tauri window controls (minimize, close).
- Integrate TitleBar into `App.tsx`.
- Reposition fixed UI elements.

**Out of Scope:**
- Maximize/restore button (window is `resizable: false` with fixed size).
- Platform-specific styling differences.
- Animations or transitions on the title bar.

# Technical Design

### Current Implementation
- **Tauri window** (`src-tauri/tauri.conf.json`): Uses default OS decorations. Window is fixed at 1200×650, non-resizable.
- **TitleBar component** (`src/components/TitleBar.tsx`): Exists but is never imported in `App.tsx`. Window control handlers are empty stubs. Styling is heavy: metallic gradients, gold accent lines, box shadows.
- **Fixed-position UI**: `SettingsIcon` at `top: 8px; right: 12px`, `TunerIcon` at `top: 52px; right: 12px`, `AudioStatusBar` at `bottom: 10px`, `Toast` at `bottom: 20px`.
- **App layout** (`src/App.tsx`): `.app` fills `100vh`, `.app-content` has `padding: 2rem 1rem 1.5rem`.

### Key Decisions
- **Frameless window**: Set `decorations: false` in Tauri config. This removes the native title bar entirely.
- **32px height**: A thin bar — enough for dragging and subtle controls, but unobtrusive.
- **No maximize button**: The window is fixed-size; a maximize button would be misleading.
- **Invisible controls on default**: Minimize and close buttons use low opacity and only become prominent on hover, keeping the bar truly minimal.
- **Match app background**: The title bar uses the same dark background (`#0a0a0a`) as the app body for a seamless transition.

### Proposed Changes

1. **`src-tauri/tauri.conf.json`** — Add `"decorations": false` to the window config.

2. **`src/components/TitleBar.tsx`** — Rewrite to:
   - Import `getCurrentWebviewWindow` from `@tauri-apps/api/webviewWindow`.
   - Implement `minimize()` and `close()` handlers.
   - Remove the maximize button.
   - Keep the drag region via `-webkit-app-region: drag` on the container.

3. **`src/components/TitleBar.css`** — Replace with minimal styling:
   - Background: `#0a0a0a` (matches app body).
   - Height: `32px`.
   - Bottom border: `1px solid rgba(255,255,255,0.06)` (barely visible separator).
   - App label: small, muted, left-aligned.
   - Control buttons: transparent, 44px wide, low opacity default, visible on hover.
   - Close button: red on hover.

4. **`src/App.tsx`** — Import and render `<TitleBar />` as the first child.

5. **`src/components/SettingsIcon.css`** — Change `top: 8px` to `top: 12px`.

6. **`src/components/TunerIcon.css`** — Change `top: 52px` to `top: 48px`.

7. **`src/App.css`** — Add `padding-top: 32px` to `.app-content` to account for the title bar.

# Delivery Steps

### ✓ Step 1: Configure Tauri window for frameless mode
Remove the native OS title bar so the custom title bar can take its place.
- Set `decorations: false` in `src-tauri/tauri.conf.json` window config.
- Keep `resizable: false` and the fixed size (1200x650) as-is.

### ✓ Step 2: Implement minimal TitleBar with working controls
Replace the existing heavy TitleBar with a clean, minimal design and wire up real window controls.
- Import `getCurrentWebviewWindow` from `@tauri-apps/api/webviewWindow` in `TitleBar.tsx`.
- Implement `minimize()` and `close()` handlers using Tauri API.
- Remove the maximize button since the window is fixed-size.
- Replace `TitleBar.css` with minimal styling: 32px height, `#0a0a0a` background, subtle bottom border, low-opacity buttons that highlight on hover.
- Keep `-webkit-app-region: drag` on the container and `no-drag` on the button area.

### ✓ Step 3: Integrate TitleBar into App and reposition fixed UI
Render the TitleBar at the top of the app and adjust all fixed-position components.
- Import and render `<TitleBar />` as the first child in `App.tsx`.
- Update `SettingsIcon.css`: change `top: 8px` to `top: 12px`.
- Update `TunerIcon.css`: change `top: 52px` to `top: 48px`.
- Update `App.css`: add `padding-top: 32px` to `.app-content` so the amp panel doesn't sit behind the title bar.