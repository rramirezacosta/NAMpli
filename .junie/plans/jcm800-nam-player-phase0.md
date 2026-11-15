---
sessionId: session-261112-173232-s8xc
---

# Requirements

### Overview
A React-based NAM (Neural Amp Modeler) player with a JCM800 Marshall amp-inspired UI. Phase 0 focuses on the **UI only** with `#TODO` markers for all backend audio integration. The app supports one amp with 10 gain levels, each backed by a separate NAM model file.

### Goals
- Create a functional, interactive JCM800-style UI in React + TypeScript
- Support 10 gain levels (gain1–gain10), each mapped to a placeholder `.nam` model
- Mark all backend/audio integration points with `#TODO` comments for Phase 1
- Support live guitar input (audio interface) — wired in Phase 1

### Scope

**In Scope (Phase 0):**
- Vite + TypeScript React project scaffolding
- JCM800-inspired minimal UI with interactive knobs
- 10 gain level selector
- Power/standby toggle
- High/Low input jack indicator
- Knob state management (values 0–10)
- Placeholder `.nam` file paths (`/models/gain1.nam` through `/models/gain10.nam`)
- `#TODO` comments for all backend integration points

**Out of Scope (Phase 0):**
- Actual NAM audio processing (WASM engine integration)
- Live audio input capture
- Audio output
- Sample playback
- Persistence of settings

### Key UI Components
- **Knobs**: Preamp Volume, Bass, Middle, Treble, Presence, Master Volume (0–10 range)
- **Gain Level Selector**: 10 positions (1–10), each loads a different NAM model
- **Power Switch**: On/Standby toggle
- **Input Jacks**: High/Low sensitivity indicator
- **Panel**: Black panel with gold/white lettering, round knobs (minimal style)

# Technical Design

### Current State
Empty project directory. Greenfield React + TypeScript app using Vite.

### Key Decisions
- **Framework**: Vite + React + TypeScript (fast dev server, type safety)
- **NAM Engine**: `neural-amp-modeler-wasm` npm package (T3kPlayer) — integration deferred to Phase 1, marked with `#TODO`
- **UI Style**: Minimal and functional — CSS-based knobs and controls inspired by JCM800, not photorealistic
- **Audio**: Live input only (no samples) — wired in Phase 1
- **State Management**: React `useState`/`useReducer` for knob states and gain level selection (no external state library needed for this scope)
- **NAM Models**: 10 placeholder `.nam` files at `public/models/gain{1-10}.nam`

### Component Structure

```
src/
  components/
    AmpPanel.tsx           # Main JCM800 panel container
    Knob.tsx               # Reusable rotary knob component
    GainSelector.tsx       # 10-position gain level selector
    PowerSwitch.tsx        # On/Standby toggle
    InputJacks.tsx         # High/Low input indicator
    Logo.tsx               # Marshall-style logo
  hooks/
    useAmpSettings.ts      # State management for all knob values
  types/
    amp.ts                 # TypeScript interfaces for amp settings
  App.tsx                  # Root component
  main.tsx                 # Entry point
public/
  models/
    gain1.nam              # Placeholder NAM files (gain1 through gain10)
    gain10.nam
```

### Data Models

```typescript
// types/amp.ts
interface AmpSettings {
  preampVolume: number;    // 0-10
  bass: number;            // 0-10
  middle: number;          // 0-10
  treble: number;          // 0-10
  presence: number;        // 0-10
  masterVolume: number;    // 0-10
  gainLevel: number;       // 1-10
  powerOn: boolean;        // true = on, false = standby
  inputSensitivity: 'high' | 'low';
}

interface NamModel {
  gainLevel: number;
  url: string;  // e.g. "/models/gain1.nam"
}
```

### Proposed Changes

1. **Scaffold project** with Vite + React + TypeScript
2. **Create reusable Knob component** with drag/rotate interaction, 0–10 range, and visual feedback
3. **Build AmpPanel** with JCM800 layout (6 knobs, gain selector, power switch, input jacks)
4. **Implement useAmpSettings hook** for centralized state management
5. **Add GainSelector** with 10 positions, each mapped to a NAM model URL
6. **Add PowerSwitch** and **InputJacks** components
7. **Mark backend integration points** with `#TODO` comments:
   - Loading NAM models
   - Initializing WASM audio engine
   - Capturing live audio input
   - Routing audio through NAM processing
   - Switching NAM models on gain level change
   - Applying EQ settings (bass, middle, treble, presence) to audio chain

### Architecture Overview

```
graph LR
  UI[AmpPanel UI] --> State[useAmpSettings Hook]
  State --> Knobs[Knob Components]
  State --> Gain[GainSelector]
  State --> Power[PowerSwitch]
  State --> Input[InputJacks]
  State -.-> TODO[#TODO: NAM Engine]
  TODO -.-> WASM[neural-amp-modeler-wasm]
  TODO -.-> Audio[Live Audio Input]
```

# Testing

### Validation Approach
Since Phase 0 is UI-only, validation focuses on component rendering and interactivity.

### Key Scenarios
- **Knob interaction**: Each knob responds to mouse drag/rotate, displays correct value (0–10), and updates state
- **Gain level selection**: Selecting a gain level (1–10) updates the current selection and displays the correct NAM model path
- **Power toggle**: Power switch toggles between On/Standby states with visual feedback
- **Input sensitivity**: High/Low input jack indicator toggles correctly
- **State persistence**: All knob values and settings are reflected in the `useAmpSettings` state

### Edge Cases
- Knob values clamp to 0–10 range
- Gain level clamps to 1–10
- Power off state visually dims/disables controls
- All `#TODO` backend calls are guarded (no runtime errors when backend is not connected)

### Test Changes
- Phase 0: Manual visual testing of UI components
- Phase 1: Add unit tests for `useAmpSettings` hook and integration tests for NAM engine connection

# Delivery Steps

### ✓ Step 1: Scaffold project and create types
Set up the Vite + React + TypeScript project and define the data models.
- Run `npm create vite@latest . -- --template react-ts` to scaffold the project
- Install dependencies (no external UI library needed, pure CSS)
- Create `src/types/amp.ts` with `AmpSettings` and `NamModel` interfaces
- Create placeholder NAM files in `public/models/gain{1-10}.nam` (empty files for now)
- Remove boilerplate Vite files

### ✓ Step 2: Build Knob component and AmpPanel layout
Create the reusable rotary knob and the main JCM800 panel layout.
- Create `src/components/Knob.tsx` with mouse drag rotation, 0–10 value range, and visual indicator
- Create `src/components/AmpPanel.tsx` with black panel, gold lettering, and 6 knobs in JCM800 layout (Preamp Volume, Bass, Middle, Treble, Presence, Master Volume)
- Style with CSS: round knobs, labels, and panel background
- Add `#TODO` comments for connecting knob values to audio EQ processing

### ✓ Step 3: Add gain selector, power switch, and input jacks
Complete the UI with remaining JCM800 controls and state management.
- Create `src/components/GainSelector.tsx` with 10 positions (1–10), each mapped to a NAM model URL
- Create `src/components/PowerSwitch.tsx` with On/Standby toggle and visual feedback
- Create `src/components/InputJacks.tsx` with High/Low sensitivity indicator
- Create `src/components/Logo.tsx` with Marshall-style branding
- Create `src/hooks/useAmpSettings.ts` for centralized state management
- Wire all components to `useAmpSettings` in `App.tsx`
- Add `#TODO` comments for:
  - Loading NAM models on gain level change
  - Initializing WASM audio engine on power on
  - Capturing live audio input
  - Routing audio through NAM processing chain

### ✓ Step 4: Convert to Electron desktop app
Wrap the Vite React app in an Electron desktop shell for native audio access.
- Install `electron`, `electron-builder`, and `cross-env` as dev dependencies
- Create `electron/main.ts` — Electron main process with BrowserWindow, dev/prod URL handling, and `#TODO` for audio backend
- Create `electron/preload.ts` — secure IPC bridge via `contextBridge` with `#TODO` for audio engine methods
- Create `vite.config.electron.ts` — separate Vite config to build the Electron main process as CommonJS
- Create `tsconfig.electron.json` — TypeScript config for Electron files
- Create `src/electron.d.ts` — TypeScript declarations for `window.electronAPI`
- Update `package.json` with `main` entry point, Electron scripts (`electron:dev`, `electron:preview`, `electron:pack`), and `electron-builder` config
- Verify both renderer and Electron builds compile successfully

### ✓ Step 5: Create Makefile with Linux AppImage target
Add a Makefile to wrap all npm/Electron build scripts with convenient make targets.
- Create `Makefile` with targets for install, clean, dev, build, lint, preview, and Electron packaging
- Add `linux-appimage` target that builds all assets then runs `electron-builder --linux AppImage`
- Add `linux-deb` target for Debian package builds
- Default `all` target runs `build-all` (renderer + Electron main process)
- Verify `make build-all` compiles successfully