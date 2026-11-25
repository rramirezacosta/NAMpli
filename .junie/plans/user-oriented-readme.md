# User-Oriented README (with hero screenshot)

> **Status: implemented.** README rewritten; the existing screenshot was moved from
> `build/screenshots/` to `docs/screenshots/`. No app or DSP changes. See [Open questions](#open-questions)
> for the few decisions still worth confirming.

# Context

`README.md` is currently a well-written but **feature-manual** document: six dense sections
(Preset manager, Model & IR Library, Reverb, Tuner, Level meters) describe internals in detail
(e.g. "deduplicated by content hash", "YIN detector fed by the input before the trim"), followed by
the untouched **React + TypeScript + Vite template boilerplate** (lines 79–110: Vite plugins, React
Compiler, Oxlint JSON snippet).

What a newcomer needs is missing:

- No hero, one-line pitch, or **screenshot in the README** — a good capture already exists at
  `build/screenshots/screenshot.png` (2504×1478, ~450 KB: powered-on amp, `Groovy Bass` preset in slot
  A2, live IN/OUT meters, 48.0 kHz · 1.3 ms status bar), but it lives in a build-artifact folder and
  is not referenced anywhere. Move it to `docs/screenshots/` and embed it in the hero.
- No "what is NAM / what do I need" explanation for someone who has never used Neural DSP mods.
- No install/build/run steps, no audio-device setup (Settings has Host / Input / Output / Latency),
  no first-session walkthrough (the app starts in bypass).
- No quick reference for keys (`1`–`4`, `Esc`/`Enter` audition, `Ctrl/Cmd+F`, `↑/↓`, drag & drop).
- No "where are my presets/files" answer — presets live in `<app_data>/presets/index.json` + one
  `.json` per preset; models/IRs in `<app_data>/library/<nam|ir>/<hash>/` (see
  `src-tauri/src/commands.rs:506,900`).
- No troubleshooting (no devices, no sound, xruns, gate hiding a quiet pickup), no dev section that
  reflects the actual Makefile, no credits/license.

Goal: keep the accurate feature knowledge but reorganize it around **what the user wants to do**,
with a real screenshot at the top and a short, honest path from "clone" to "sound".

# Goals / non-goals

**Goals**
1. A first-time visitor understands what NAMpli is, sees the UI, and can get sound in ~5 minutes.
2. Sections are task-oriented ("Play a preset", "Manage your library", "Tune"), not internal-oriented.
3. Embed the existing screenshot of the populated faceplate from a stable path, with alt text and caption.
4. Document shortcuts/keys in one scannable table; add a troubleshooting/FAQ section.
5. Replace the Vite/Oxlint boilerplate with a real Development section derived from `Makefile` and
   `package.json`; add Credits/License placeholders.
6. Preserve all currently correct behaviour notes (autosave, keep/revert precedence, bypass recall,
   global audio settings) in a more digestible form.

**Non-goals**
- Changing app code, UX, or wording of in-app labels.
- Exhaustive backend/implementation detail (move it out of the main narrative or drop it).
- Multiple screenshots in this pass (library/tuner shots are a follow-up).
- Writing a separate docs site/changelog.

# Proposed README structure

```
# NAMpli                          ← hero: pitch + screenshot + short "why" line
[![screenshot](docs/screenshots/faceplate.png)](docs/screenshots/faceplate.png)
*NAMpli's faceplate: four banks of presets, seven knobs, IN/OUT meters and the live audio status bar.*

## What is NAMpli?                ← 2 short paragraphs: NAM captures + cab IR, local/offline, Tauri desktop app
## What you need                  ← interface, .nam capture, .wav IR, monitors; Linux/JACK note
## Quick start                    ← numbered steps: install → first launch → power → load → play
## The faceplate                  ← knobs, meters, status bar (short table), power
## Working with presets           ← 4×4 board, audition/keep/revert, autosave, slot menu, Edit…, keys 1–4
## Model & IR Library             ← import, preview/load, export/rename/delete, clean up, drag & drop
## Tools                          ← tuner, settings, keyboard shortcuts table
## Where your files live          ← app data paths per OS, preset JSON, deduplicated library, backups
## Troubleshooting / FAQ          ← no sound, no devices, latency/xruns, gate & quiet pickups, presets after restart
## Development                    ← prerequisites, make targets, project layout, plan docs
## Credits & License              ← NAM / nam-dsp, Tauri, cpal; license placeholder (or actual license)
```

**Rewriting principles**
- Lead with the outcome ("Audition any of 16 presets instantly"), then the detail — not the reverse.
- Turn the current prose blocks into steps, short bullets and tables. Keep sentences short.
- Use one consistent vocabulary with a tiny glossary in "What is NAMpli?": **NAM model** (`.nam`
  amp capture), **cab IR** (`.wav` speaker response), **slot** / **bank** (A–D, 1–4), **audition**
  (temporary preview with Keep/Revert).
- Tuck implementation facts under "Where your files live" / Development only where they help users
  (content-hash dedup → "importing twice won't waste disk space"; tap points → drop; YIN details → drop).
- Delete lines 79–110 (Vite template text) entirely.
- Keep markdown line length ~100 chars for diff readability; add a TOC only if the result exceeds
  ~10 sections.

# Screenshot

A suitable capture already exists at `build/screenshots/screenshot.png` (2504×1478, ~450 KB,
non-ignored by git). It shows exactly the desired state: amp ON, `Groovy Bass` selected in A2 with a
NAM loaded, other slots named/empty, IN/OUT meters live, status bar showing `48.0 kHz · 1.3 ms ·
0 xruns`. Minor caveat: it displays `NO CAB` / `No cab IR`, so the caption must not claim a cab IR
is loaded — or the shot can be re-taken later with an IR for an even better hero.

### Move and markup
- Move the file out of the build-artifact folder: `docs/screenshots/faceplate.png` (new directory).
  It is already a reasonable size, so no re-encoding is needed.
- In the README hero: wrap the image in a link to the full-size file and use meaningful alt text,
  e.g. `![NAMpli faceplate with four preset banks, knobs and IN/OUT meters](docs/screenshots/faceplate.png)`,
  plus a one-line caption naming the visible elements.
- Optional follow-up (not this pass): re-capture with a cab IR loaded, add shots of the Model & IR
  Library or tuner, and/or a callout-annotated version of the hero. If re-capturing, use the native
  Tauri window (`make dev` / `make tauri-build-debug && ./src-tauri/target/debug/app`) rather than a
  browser: the browser build has no audio backend, so the status bar would be misleading. ImageMagick
  `import` is available on this machine for the capture.

# Implementation phases

### Phase 1 — Move the screenshot into place
`mkdir -p docs/screenshots && mv build/screenshots/screenshot.png docs/screenshots/faceplate.png`.
Verify the PNG renders and the caption matches what is actually visible (no cab IR in frame).

### Phase 2 — Rewrite the README
- Replace the opening with hero + pitch + "What is NAMpli?" + "What you need".
- Add a 5-step Quick start (install/build → first launch → choose audio devices → power on → load a
  NAM/IR or recall a preset → play). Reference `make dev` / `make tauri-build` and the Settings panel.
- Condense the six current feature sections into: The faceplate, Working with presets, Model & IR
  Library, Tools. Preserve: 1–4 keys, Esc/Enter keep/revert, autosave + gold dot, slot menu actions,
  Edit… behaviour, library import/preview/export/rename/delete/clean-up, tuner + A4 offset, level
  meter meaning, reverb 0–10 and its old-preset fallback, global (non-preset) audio settings.
- Add the keyboard-shortcut table and "Where your files live" (per-OS app data paths; note that
  presets keep their model/cab after restart and that files are deduplicated by content hash).
- Add Troubleshooting/FAQ with 4–6 realistic problems and fixes (point at Settings → Host/Input/
  Output/Latency, the IN meter and the tuner's pre-gate tap, `Esc` to leave a view, Import to
  re-add a missing asset).
- Replace the template section with Development: prerequisites (Node/npm, Rust/cargo, JACK headers
  on Fedora via `PKG_CONFIG_PATH`), the `make` targets (`dev`, `build`, `lint`, `rust-check`,
  `rust-fmt`, `rust-clippy`, `tauri-build`, `tauri-build-debug`, `clean`), and a brief source map
  (`src/components`, `src/hooks`, `src-tauri/src`, `.junie/plans/`).
- Add Credits & License (existing deps: NAM / `nam-dsp`, Tauri, cpal, React/Vite; use a placeholder
  only if no license file exists — confirm with user).

### Phase 3 — Review pass
- Read top to bottom as a first-time user: any jargon without explanation? any dead end?
- Cross-check every command and path against `Makefile`, `package.json` and
  `src-tauri/tauri.conf.json`; verify no stale template lines remain.
- Verify the image link/alt text and that the screenshot shows what the caption claims.
- `git diff --check`; confirm no app source files changed.

### Phase 4 — Follow-ups (optional, separate change)
Screenshot of Library + tuner views; annotated hero; split long sections into `docs/`; add a
CONTRIBUTING.md if development docs grow.

# Acceptance criteria

1. README opens with a pitch and a working, attributed screenshot of a populated, powered-on amp.
2. A new user can find install steps, audio setup, a first-sound walkthrough, shortcuts, file
   locations and troubleshooting without reading source code.
3. All previously accurate feature behaviour is retained in condensed form; no Vite template text.
4. Development section matches the actual Makefile/package.json commands.
5. Screenshot is committed under `docs/screenshots/`, optimized, with alt text and caption.
6. Only `README.md` and the new screenshot asset change.

# Open questions

1. **License — resolved:** GNU GPL v3 only (GPL-3.0-only) was added in `LICENSE` and declared in
   `package.json`, `src-tauri/Cargo.toml` and the README after this README work was done.
2. **Re-capture** — worth retaking the hero with a cab IR loaded (the current shot shows `No cab IR`),
   or is the existing one fine as-is?
3. **Extra screenshots** — is a second image of the Library/tuner wanted later?
4. **Audience emphasis** — prioritize musicians just plugging in (bigger Quick start) or existing
   NAM users evaluating the app (bigger feature comparison)? Default: musicians first.
