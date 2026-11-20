# Requirements

### Overview
NAMpli renders its own frameless title bar (`decorations: false` in `tauri.conf.json`) and always puts the minimize/close buttons at the far right. Real OS title bars do not agree on this: stock GNOME and Windows put controls on the right, while Ubuntu GNOME (and macOS) put them on the left. On this dev machine, for example:

```
$ gsettings get org.gnome.desktop.wm.preferences button-layout
'close,minimize:appmenu'
```

That value means "close and minimize on the **left** of the title, app menu on the right" — so the current custom title bar mirrors the wrong side. The goal is to read the OS/desktop setting and lay out the custom controls to match, with GNOME as the primary target but a sensible cross-platform fallback chain.

### Goals
- Detect the window-control button side at startup, GNOME first, with defined fallbacks for other Linux desktops, Windows, and macOS.
- Apply the detected side to `TitleBar` — both which end the buttons sit on and their order within the group (close-first on the left, minimize-first on the right).
- No new Rust or npm dependencies; graceful, silent fallback to "right" when no OS setting is available (including plain-browser `npm run dev`).
- Keep the detection logic testable: pure parser functions + `#[cfg(test)]` unit tests, and return a structured result (`side`, `source`, `layout`) that is useful for debugging via `log_to_terminal`.

### Scope
**In Scope:**
- New Rust module for detection/parsing + one Tauri command.
- Command registration in `lib.rs` and an `invoke` wrapper in `src/tauri.ts`.
- A small React hook following the existing `useAudioStatus`/`useAmpSettings` pattern.
- `TitleBar.tsx` / `TitleBar.css` changes to honor the detected side.
- Unit tests for the parsers and manual verification on GNOME.

**Out of Scope:**
- Adding a maximize button (window is `resizable: false`, fixed 1200×650).
- User-facing manual override in `SettingsPanel` (can be added later as a complement to auto-detection).
- Live updates when the setting changes while the app is running (documented as an optional follow-up).
- Per-DE button glyphs, colors, or hover styles — only placement/order changes.

# Technical Design

### Current Implementation
- `src-tauri/tauri.conf.json`: `decorations: false`, `resizable: false` — the app owns the title bar entirely.
- `src/components/TitleBar.tsx`: a `.titlebar-drag-region` (`flex: 1`) followed by `.titlebar-controls` containing **minimize, then close**. Because `.titlebar` uses `justify-content: space-between` and controls are the last child, they always land on the right.
- `src/components/TitleBar.css`: `.titlebar-controls { display: flex; align-items: center; }`, 44px buttons, no side awareness.
- `src/tauri.ts`: the single frontend `invoke` wrapper layer; `src/hooks/`: one-shot/polling hooks; `src-tauri/src/lib.rs`: the single `generate_handler!` list. No platform detection exists anywhere yet.
- Capabilities already allow `start-dragging`, `minimize`, `hide` — no permission changes needed.

### Sources of truth per platform

| Platform | Source | Parsing rule | Fallback |
|---|---|---|---|
| **GNOME** | `gsettings get org.gnome.desktop.wm.preferences button-layout` | `<left>:<right>`, comma-separated tokens. Count control tokens (`close`, `minimize`, `maximize`, `hide`) on each side; more on left ⇒ Left, more on right ⇒ Right. Current machine: `close,minimize:appmenu` ⇒ Left. | Right |
| **Cinnamon** | `gsettings get org.cinnamon.desktop.wm.preferences button-layout` | Same colon parser as GNOME. | Right |
| **MATE** | `gsettings get org.mate.Marco.general button-layout` (verify exact key/schema during implementation) | Same colon parser. | Right |
| **XFCE** | `xfconf-query -c xfwm4 -p /general/button_layout`, or read `~/.config/xfce4/xfconf/xfce-perchannel-xml/xfwm4.xml` if the tool is absent | Letters before `|` are the left group, after `|` the right group; `H`=minimize, `M`=maximize, `C`=close, `O`=menu. Count H/M/C on each side. Best-effort. | Right |
| **KDE Plasma** | Default is right. Optional best-effort read of `~/.config/kwinrc` `[Windows] TitleButtons` via `kreadconfig6`/`kreadconfig5`; verify parseability before relying on it. | Right |
| **Windows** | No standard OS setting to move the buttons. | Right |
| **macOS** | Traffic lights are always left. | Left |

Notes:
- `gsettings` is backed by dconf/D-Bus, so it works on both X11 and Wayland — no X11 libraries or display access needed.
- On Linux, use `XDG_CURRENT_DESKTOP` only as a hint for which schema to try first; always attempt the gsettings keys regardless (the variable is often unset when launched from a terminal or a .desktop file).
- Spawn programs with `std::process::Command::new(program).args([...]).output()` — direct args, no `sh -c`, so there is no shell-injection surface. Commands are short-lived; a single call at startup is cheap.
- Sandboxed/Flatpak builds may see a sandboxed dconf and report the wrong (or no) value: detection returns "Right" and logs the source, never fails the app.

### Key Decisions
- **Detection lives in Rust, not JS.** The frontend cannot read gsettings/dconf, and the existing architecture already funnels native information through `src/tauri.ts` + hooks.
- **Pure parsers separate from I/O.** `parse_button_layout()` and `parse_xfwm4_layout()` take `&str` and return `Option<WindowControlsSide>`; the subprocess wrapper just returns `Option<String>`. This makes the GNOME layout grammar unit-testable without a running session bus.
- **Structured result:** `WindowControlsInfo { side, source, layout }` with `#[serde(rename_all = "camelCase")]`, mirroring `TunerStatus` in `commands.rs`. `source` and `layout` are logged once so mismatches can be diagnosed.
- **Frontend default is `"right"`** until the command resolves; in a plain browser `invoke` rejects and the hook silently keeps the default.
- **CSS-only positioning switch:** a `titlebar--controls-left` class on `.titlebar` flips the controls to the first flex slot (`order: -1`). Button order within the group is handled in JSX so the two sources of truth (side + order) stay together: left ⇒ `close, minimize`; right ⇒ `minimize, close`. The drag region keeps `flex: 1`, so it works on either side.
- **Live updates are a follow-up.** If desired later: spawn `gsettings monitor org.gnome.desktop.wm.preferences button-layout`, pipe stdout lines through the same parser, and emit a Tauri event the hook listens to via `@tauri-apps/api/event`. Not needed for the initial fix.

### Proposed Changes

1. **`src-tauri/src/window_controls.rs` (new)** — the whole detector:
   - `enum WindowControlsSide { Left, Right }` (Serialize, lowercase) and `struct WindowControlsInfo { side, source, layout }` (Serialize, camelCase).
   - `fn parse_button_layout(layout: &str) -> Option<WindowControlsSide>` — split on `':'` into left/right parts (a string with no colon is treated as right), split each on `','`, trim, count tokens in `{close, minimize, maximize, hide}`. Ties/no controls ⇒ `None`.
   - `fn parse_xfwm4_layout(layout: &str) -> Option<WindowControlsSide>` — split on `'|'`, count chars in `{'H','M','C'}` on each side. Ties ⇒ `None`.
   - `fn gsettings_layout(schema: &str) -> Option<String>` and `fn xfwm4_layout() -> Option<String>` — thin `Command` wrappers, checking exit status and trimming quotes/whitespace.
   - `pub fn detect() -> WindowControlsInfo` — `cfg!(target_os = "macos")` ⇒ Left; `cfg!(target_os = "windows")` ⇒ Right; on Linux try GNOME → Cinnamon → MATE → XFCE, using the first parser that yields a side; otherwise Right with `source: "default"`.
   - `#[tauri::command] pub fn get_window_controls_info() -> WindowControlsInfo`.
   - `#[cfg(test)] mod tests` — table-driven cases: `close,minimize:appmenu` ⇒ Left (this machine), `close,minimize,maximize:` ⇒ Left, `appmenu:minimize,maximize,close` ⇒ Right, `:minimize,maximize,close` ⇒ Right, `minimize,maximize,close` ⇒ Right, `appmenu:` ⇒ None, `O|HMC` ⇒ Right, `C|HMO` ⇒ Left.

2. **`src-tauri/src/lib.rs`** — add `mod window_controls;` and register `window_controls::get_window_controls_info` in `generate_handler!`.

3. **`src/tauri.ts`** — add `WindowControlsSide`, `WindowControlsInfo`, and `getWindowControlsInfo(): Promise<WindowControlsInfo>` using `invoke('get_window_controls_info')`.

4. **`src/hooks/useWindowControlsSide.ts` (new)** — one-shot `useEffect` with a `cancelled` guard (same pattern as `useAudioStatus`), starting at `"right"`, silently catching invoke failures, returning `'left' | 'right'`.

5. **`src/components/TitleBar.tsx`** — call the hook; add `titlebar--controls-left` to the `.titlebar` class list when the side is left; render `.titlebar-controls` before the drag region on the left, with `close` then `minimize`; keep the existing handlers unchanged.

6. **`src/components/TitleBar.css`** — keep `.titlebar-drag-region { flex: 1 }`; add a rule so the controls occupy the first slot when the left modifier class is present (the JSX already reorders them, so `order: -1` is a belt-and-braces guard rather than the primary mechanism). No changes to button visuals.

7. **Verification** — `cargo test --manifest-path src-tauri/Cargo.toml` for parser tests; run the app and confirm controls are on the left with this machine's current setting, then temporarily `gsettings set org.gnome.desktop.wm.preferences button-layout 'appmenu:minimize,maximize,close'` and confirm the app shows them on the right after restart. **Restore the original value afterwards.** Also check `npm run dev` (plain browser) still renders the right-side default with no uncaught errors.

# Delivery Steps

### Step 1: Build the Rust detector with unit tests
Add `src-tauri/src/window_controls.rs` with the side enum, structured info type, pure parsers, the subprocess helpers, `detect()`, the command, and parser tests. Run the tests before wiring anything up.

### Step 2: Expose the result to the frontend
Register the command in `lib.rs`, add the wrapper/types in `src/tauri.ts`, and add `useWindowControlsSide` with the standard cancelled-guard effect and a `"right"` default.

### Step 3: Make the title bar side-aware
Update `TitleBar.tsx` and `TitleBar.css` so the controls group and its button order follow the hook's value without touching the drag/minimize/close behavior.

### Step 4: Verify across layouts
Check both GNOME button-layout values (left and right), the plain-browser fallback, and the Rust unit tests. Confirm no capability/config changes are required and that the app still builds (`npm run build`, `cargo test`).

### Optional follow-up (not in this change)
Monitor the gsettings key at runtime and emit a Tauri event so the title bar re-lays-out live when the user changes the setting without restarting; optionally expose a manual Left/Right override in `SettingsPanel` for users whose desktop does not publish a detectable value.
