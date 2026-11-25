# NAMpli

**NAM, made simple.**

[![Download / build from source](https://img.shields.io/badge/-DOWNLOAD-55595e?style=for-the-badge)](#development)![Version 0.1.0](https://img.shields.io/badge/-V0.1.0-f04e36?style=for-the-badge)![Cross-platform: Windows, Linux](https://img.shields.io/badge/-WINDOWS%20%C2%B7%20LINUX-3c4043?style=for-the-badge)[![Free and open source under GPL-3.0](https://img.shields.io/badge/-FREE%20%C2%B7%20OPEN%20SOURCE-3aab78?style=for-the-badge)](LICENSE)

A desktop amp for playing [Neural Amp Modeler](https://github.com/NeuralAmpModelerCore/NAM)
(NAM) guitar and bass captures through a cabinet impulse response (IR). Runs locally, offline,
with your audio interface — no plugin host or DAW needed.

[![NAMpli faceplate with four preset banks, seven knobs and live IN/OUT meters](docs/screenshots/faceplate.png)](docs/screenshots/faceplate.png)

## What you need

- An audio interface (or other input/output device) with your guitar or bass plugged in, plus
  headphones or studio monitors.
- At least one NAM capture (`.nam`). Community captures are available from the
  [NAM project](https://github.com/NeuralAmpModelerCore/NAM) and capture libraries.
  A cabinet IR (`.wav`) is optional but recommended for a realistic guitar tone.
- NAMpli is currently built from source — see [Development](#development).
- On Linux, NAMpli is built with JACK support; other available hosts (such as ALSA or PulseAudio)
  can also be selected in Settings. You'll need JACK development headers installed (see
  [Development](#development)).

## Model & IR Library

The book icon opens a full-window browser for stored `.nam` and `.wav` files. Search by filename or
by the presets using it, filter by Models / IRs, and sort by name, kind, size, date or usage. Each
row shows file size, when it was added and how many presets use it; the details panel lists those
presets.

- **Import…** stores a copy of a `.nam` or `.wav` file without changing the live sound. Files are
  deduplicated by content hash, so importing the same file twice doesn't waste disk space.
- **Load** changes the live model or IR immediately. **Preview** (double-click, or `Enter` on a
  selected row) auditions it with the same Keep / Revert banner as preset auditions.
- **Export…** saves the original bytes to a path you choose. **Rename** changes the display name,
  updates every preset that referenced it, and reloads it if it is currently loaded. **Delete**
  removes the file after confirmation if presets use it, clearing those references.
- **Clean up…** removes files no preset uses. Files loaded in the rig are always kept, and the
  confirmation lists what would be deleted.
- `↑`/`↓` navigate rows, `Ctrl/Cmd+F` focuses search, and `Esc` or **← Back to amp** returns to the
  faceplate (`Esc` first reverts an active preview).

Dropped `.nam` and `.wav` files are imported and loaded immediately from any view, and the Library
refreshes to show them.


## Where your files live

Everything is stored locally in NAMpli's application data directory (`com.nampli.app`):

| Platform | Application data directory |
| --- | --- |
| Linux | `~/.local/share/com.nampli.app` (or `$XDG_DATA_HOME/com.nampli.app`) |
| Windows | `%APPDATA%\com.nampli.app` |

- `presets/index.json` lists the 4×4 grid; each preset is a separate `.json` file in `presets/`.
- `library/nam/` and `library/ir/` hold the imported model and cabinet files, each in a folder
  named after its content hash.
- To back up your rig, copy the whole application data directory. Audio device and buffer-size
  settings are global, not stored in presets.

## Troubleshooting / FAQ

- **No sound / status says "Standby".** Turn the amp on with the **ON** switch, then load a model or
  recall a preset — the app starts in bypass. Check that Output isn't at 0.
- **No devices listed.** Open Settings and try a different **Audio Host** (for example JACK vs.
  ALSA/PipeWire), then reselect input and output devices.
- **Clicks, crackles or xruns** (shown in the status bar). Increase **Latency** in Settings (e.g.
  512 or 1024 samples), and close other audio-hungry apps.
- **Notes cut out or the amp is silent but the tuner works.** The tuner listens before the gate.
  Lower the **Gate** knob, or raise your input level while watching the **IN** meter.
- **A preset lost its model or cabinet.** Re-import the file (dropping it loads it immediately) or
  check that the original is still in the Library; deleting a file clears references from presets.
- **I tried a preset and want my sound back.** Press `Esc` or click **Revert** in the audition
  banner before accepting it.

## Credits & License

Built with [Tauri](https://tauri.app/), React, Vite, cpal and the
[Neural Amp Modeler](https://github.com/NeuralAmpModelerCore/NAM) DSP.

NAMpli is free software licensed under the [GNU GPL version 3](LICENSE) (GPL-3.0-only).
