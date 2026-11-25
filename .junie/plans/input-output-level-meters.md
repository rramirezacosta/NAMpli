# Input / Output Level Meters (UI)

# Requirements

### Overview
Add two always-visible vertical level meters to the amp faceplate, matching the reference image:
a dB-scaled track, a green → gold → red LED-style bar, a numeric dB readout at the bottom, and an
`IN` / `OUT` label. `IN` shows the **raw guitar input** (before trim, gate, NAM, IR, EQ, reverb and
limiter) so the interface/pickup level can be staged correctly; `OUT` shows the **final signal**
that is handed to the output device (post limiter), i.e. what the player actually hears.

Both meters are read-only observations. They must not change the sound, add audio latency, touch
presets/rig state, or add dependencies. The DSP work is a handful of flops per sample on the existing
`nam-dsp` worker and can run unconditionally while audio is streaming — no "scope open" flag is
needed, because these meters live permanently in the faceplate.

### Goals
- Vertical `IN` and `OUT` meters with a `0 … -60 dBFS` scale, smoothed bar, peak-hold marker and
  numeric readouts (current level + peak), styled like the reference image and the existing
  gold-on-black faceplate.
- Correct tap points: `IN` pre-trim (independent of the Input knob and gate), `OUT` post-limiter
  (independent of downstream knobs only in the sense that they are already applied).
- Idle state when powered off or before the first frame; no stale data across power cycles.
- No locks/allocations in either cpal callback, no stream restarts, no xruns, no extra sample delay.

### In Scope
- **Backend**: a self-contained `level_meter.rs` DSP module (rolling RMS, peak, peak-hold decay,
  clip latch), two taps in the `nam-dsp` worker, snapshot fields on `SharedState`, a `get_meters`
  command and its registration.
- **Frontend**: an `invoke` bridge, a ~30 Hz polling hook, a `LevelMeter` component (two instances
  in a meter bank) rendered in `AmpPanel`, and CSS in the fixed 1200×650 window.
- **Docs**: a short README note describing what each meter measures.

### Out of Scope
- Changing the trim curve, gate, tuner, EQ, limiter or any other DSP behaviour.
- New rig/preset fields, Settings toggles, popups, window resize or test framework.
- Stereo meters — the input callback is deliberately mono (channel 0), matching the tuner and the
  whole DSP chain.

### UX behaviour
- `IN` and `OUT` meters sit at the lateral edges of `.knob-row`, flanking the three knob groups
  (see [Layout](#layout) for the width budget).
- Each meter: labelled track, tick labels at `0 / -10 / -20 / -30 / -40 / -50 / -60 dB` (log-style
  mapping: -20 dB at the vertical midpoint), fill from the
  bottom, thin peak-hold line that falls back over ~1 s, and a dark readout box showing e.g.
  `-12.3` (RMS) and `-6.1` (peak). A small red CLIP dot lights for ~1 s after a sample ≥ -0.1 dBFS;
  the output meter uses the same threshold as a "limiter engaged" hint (soft_clip saturates above
  -1 dBFS, so true digital clipping should never occur there).
- Power off → bars drop to zero, readouts show `0.0`/`--`, clip dots off; no polling while off or
  while the Library view is open. Power on → first frame replaces idle state within ~33 ms.
- `role="meter"` with `aria-valuenow/min/max` and a dB `aria-valuetext`; the decorative scale is
  `aria-hidden`, following the accessibility conventions used by `Knob` and `Tuner`.

# Technical Design

### Current Implementation
- `src-tauri/src/audio_engine.rs:384–392` — input callback pushes channel 0 into the raw ring; it
  must stay allocation- and lock-free.
- `audio_engine.rs:436–440` — worker pops a block into `buffer[..got]` (`MAX_BLOCK = 256`, ~5 ms at
  48 kHz).
- `audio_engine.rs:442–470` — UI parameters are snapshotted from `SharedState` once per block.
- `audio_engine.rs:474–478` — `tuner.push(&buffer[..got])` sees the raw input; a good reference for
  where `IN` must tap, but `tuner_level_db` is pitch-detection specific and updated only when a
  pitch is found, so it must not be reused as a meter.
- `audio_engine.rs:490–512` — trim/gate loop mutates `buffer[..got]` in place; capture `let raw =
  *sample;` here, **before** `*sample = x`, for the input meter.
- `audio_engine.rs:571–578` — final DC-block/gain/soft-clip loop; accumulate the written value
  `*sample` after `soft_clip(...)` for the output meter.
- `audio_engine.rs:580` — `out_producer.push_slice(&buffer[..got])`: the audio hand-off. All meter
  state updates must happen **after** this line so they can never delay the device.
- `audio_engine.rs:104–106, 132–133` — `SharedState` tuner fields + init; `audio_engine.rs:785–809`
  — `status()` / `tuner()` accessors to mirror.
- `src-tauri/src/commands.rs:309–323` — camelCase `TunerStatus` + `get_tuner` pattern;
  `src-tauri/src/lib.rs:36–76` — `generate_handler!` registration point.
- `src/tauri.ts:106–113` — TS interface + `invoke` bridge pattern; `src/hooks/useAudioStatus.ts:18–56`
  — polling effect with `cancelled` guard; `src/components/Tuner.tsx:29–48, 70–75` — live polling
  and a moving indicator driven by an inline style.
- Historical reference (feature was removed in `b4b9428`): `git show c2976bd:src-tauri/src/visualizer.rs`
  had `level_db`/`peak_db` with `DB_MIN = -90`, `20 * log10`, clamping and unit tests — reuse its
  maths, but not its symbols (none exist in the current tree). `.junie/plans/input-level-visualization.md`
  is a stale plan for a Scope popup meter; its architecture advice (accumulate in-loop, publish
  after hand-off, one poll loop, camelCase snapshot) still applies.

### Layout
The meters flank the knob groups as the first and last children of `.knob-row`: `IN`, Input/Gate,
Equalizer, Output, `OUT`. The unmodified row uses ~920 px of the ~992 px inner panel width (100 px
knobs: `Knob.css:11–12`; 1.25 rem group gaps), so a little spacing has to be reclaimed without
shrinking the knobs (their tick geometry assumes a 100 px wrapper):

- `.knob-row` gap 1.25 rem → 0.75 rem (now four gaps, not two);
- `.knob-group` horizontal padding 1 rem → 0.75 rem, `.knob-group-controls` gap 1 rem → 0.85 rem;
- each meter is ~41 px wide (18 px scale + 2 px gap + 13 px track + 8 px clip dot gutter).

Recomputed row width ≈ 962 px, leaving ~30 px of slack. Meters are `align-self: center` so their
~172 px height aligns with the ~186 px knob groups. Keep `overflow: hidden` and no scrolling.

### Key Decisions
1. **Two independent taps.** `IN` is accumulated from the raw sample in the trim/gate loop; `OUT`
   from the final clipped sample in the gain loop. Both answer different gain-staging questions.
2. **Accumulate in the existing loops; publish after `out_producer.push_slice`.** No extra copies,
   no allocation, no latency, no work on the audio callbacks.
3. **Always-on analysis, cheap by construction.** A rolling sum of squares + peak per meter is far
   lighter than the removed FFT/scope; since the meters are permanent UI, no enable command, no
   `document.hidden` gate and no extra Tauri capability are needed.
4. **Store snapshots in `SharedState`**, alongside `tuner_*`, with a `try_lock()` write after the
   hand-off so a slow UI poll can never block the worker (a dropped frame is invisible at 30 Hz).
   No new `Arc`/`Mutex` pair to thread through the worker.
5. **Decay/latch in Rust, rendering only in React.** Peak-hold (~1 s hold, ~20 dB/s fall) and clip
   latch (~1 s) live on the worker so transients survive between polls; the frontend just maps dB
   to a percentage. Same rationale as the old visualization plan.
6. **Mirror serde shapes.** `#[serde(rename_all = "camelCase")]` in Rust and a matching TS interface
   (`levelDb`, `peakDb`, `peakHoldDb`, `clipped`).
7. **No rig/preset impact.** Meters are observation only; no `AmpSettings`/`RigSnapshot` fields and
   no dirty tracking. Bypass with no NAM/IR still shows `IN`.

### Latency & CPU safety
No changes to either cpal callback: no buffers, no locks, no device-period change. The worker does a
few flops per sample inside loops that already run, one `try_lock()` per block after the output
hand-off, and one lock-free read per UI poll. Check `AudioStatusBar` xruns before/after with the app
running (`make dev` builds the Rust side at `opt-level = 1`). Visual lag is one ~33 ms poll plus a
CSS transition; it never affects audio.

### Data model
```rust
// src-tauri/src/level_meter.rs
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeterReading {
    pub level_db: f32,      // rolling RMS, dBFS
    pub peak_db: f32,       // rolling peak, dBFS
    pub peak_hold_db: f32,  // decaying hold marker, dBFS
    pub clipped: bool,      // latched ~1s after >= -0.1 dBFS
}
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeterSnapshot {
    pub input: MeterReading,
    pub output: MeterReading,
}
```
```ts
// src/tauri.ts
export interface MeterReading {
  levelDb: number;
  peakDb: number;
  peakHoldDb: number;
  clipped: boolean;
}
export interface MeterSnapshot { input: MeterReading; output: MeterReading; }
export async function getMeters(): Promise<MeterSnapshot>;
```

### Proposed Changes

**Backend — `src-tauri/src/level_meter.rs` (new)**
- `DB_MIN = -60.0` (matches the UI scale), `DB_MAX = 0.0`, `CLIP_DB = -0.1`,
  `WINDOW_MS = 100.0`, `HOLD_DECAY_DB_PER_S ≈ 20.0`, `CLIP_HOLD_S = 1.0`.
- `pub struct LevelMeter` with a preallocated rolling window of per-block aggregates (or a fixed
  `Vec<f32>` of samples sized from the sample rate), `sum_sq`, `peak`, `peak_hold_db`,
  `clip_samples_left`, `sample_rate`. Methods: `new(sample_rate)`, `prepare(sample_rate)` (clear
  history on stream restart), `push(block_sum_sq: f64, block_peak: f32, frames: usize) -> MeterReading`.
  No allocation in `push`.
- `fn dbfs(amplitude: f32) -> f32`: `20 * log10`, clamp to `DB_MIN..DB_MAX`, guard zero/NaN.
- Unit tests: silence → very low/no clip; 0.5 sine → ~-9 dBFS RMS, ~-6 dBFS peak; full-scale
  sample sets `clipped` then clears after the hold; peak-hold decays monotonically; `prepare()`
  clears; all outputs finite and bounded. Mirror the old `visualizer.rs` tests.

**Backend — `src-tauri/src/audio_engine.rs`**
- `pub mod level_meter` / `use` at the top; add `meter_input`, `meter_output` snapshot fields to
  `SharedState` (`:104–106`) initialised with idle readings (`DB_MIN`, `clipped: false`) in
  `new()` (`:132–133`).
- In the worker, construct `let mut in_meter = LevelMeter::new(sample_rate);` and `out_meter`
  alongside `tuner` (`:426`). Reset both on stream start/stop where tuner state is reset
  (`:341–343`, and the stop path).
- In the trim/gate loop (`:490–512`), accumulate `in_sum_sq += raw²` and `in_peak = max(|raw|)`
  from `let raw = *sample;` before scaling. In the final loop (`:571–578`), after
  `*sample = soft_clip(...)`, accumulate `out_sum_sq` / `out_peak` from the written value.
- **After** `out_producer.push_slice(&buffer[..got])` (`:580`), call
  `in_meter.push(in_sum_sq, in_peak, got)` and `out_meter.push(...)` and publish both with one
  `try_lock()` on `state` (or two — keep it simple and never block).
- `pub fn meters(&self) -> MeterSnapshot` accessor next to `tuner()` (`:805–809`), returning a copy.

**Backend — `src-tauri/src/commands.rs`**
- Add `#[tauri::command] pub fn get_meters(engine: State<...>) -> Result<MeterSnapshot, String>`
  next to `get_tuner` (`:316–323`), using the serde structs from `level_meter.rs`.

**Backend — `src-tauri/src/lib.rs`**
- Add `mod level_meter;` as needed and register `commands::get_meters` in `generate_handler!`
  (`:36–76`).

**Frontend — `src/tauri.ts`**
- Add `MeterReading`, `MeterSnapshot` and `getMeters()` (invoke `get_meters`) near `TunerStatus`
  (`:106–113`).

**Frontend — `src/hooks/useMeters.ts` (new)**
- `useMeters(active: boolean): MeterSnapshot | null`, modelled on `useAudioStatus.ts:18–56`:
  immediate poll, `window.setInterval(poll, 33)`, `cancelled` guard, clear on deactivate, catch and
  ignore transient IPC errors. `App` calls it with `view === 'amp' && settings.powerOn`.

**Frontend — `src/components/LevelMeter.tsx` / `LevelMeter.css` (new)**
- `LevelMeter` props: `label`, `reading: MeterReading | null`, `active: boolean`. Compute
  `level = clamp((levelDb + 60) / 60, 0, 1)` and the same for `peakHoldDb`. The fill is a full-height
  green → gold → red gradient clipped with `clip-path: inset(...)` (so the colour zones stay anchored
  to the dB scale) and a 0.08 s transition; the peak-hold marker animates `bottom`. A fixed
  repeating-linear-gradient overlay forms the LED segments; tick labels come from a constant array,
  `aria-hidden`. Readout uses `font-variant-numeric: tabular-nums` (`Tuner.css:40–44`).
- Two `LevelMeter`s are placed directly in `AmpPanel` (no separate bank component).

**Frontend — `src/components/AmpPanel.tsx` / `.css`**
- Add `meters: MeterSnapshot | null` and `powerOn`-derived active state to `AmpPanelProps`; render
  `<LevelMeter label="IN" …/>` as the first child and `<LevelMeter label="OUT" …/>` as the last child
  of `.knob-row`, flanking the three knob groups.
- `.knob-row`: `align-items: center`, gap reduced to 0.75 rem; `.knob-group` horizontal padding and
  `.knob-group-controls` gap tightened; `.knob-row > .level-meter { flex: 0 0 auto; }`.
  `.level-meter` is ~41 px wide with a 138 px track, dark inset track and gold labels; no scroll.

**Frontend — `src/App.tsx`**
- Call `const meters = useMeters(view === 'amp' && settings.powerOn);` and pass `meters={meters}`
  to `<AmpPanel>` (`:383–404`). No change to the Library view or dialogs.

**Docs — `README.md`**
- Describe the two meters, what each tap measures, the -60..0 dBFS scale, peak-hold/clip, and that
  they are read-only and idle when powered off.

### Delivery Steps
- [x] **Step 1 — Meter DSP.** Add `level_meter.rs` with rolling levels, peak-hold, clip latch and
      unit tests. Verify `cd src-tauri && cargo test`.
- [x] **Step 2 — Engine + command wiring.** Add `SharedState` fields, worker instances, in-loop
      accumulation, post-hand-off publish, accessor, `get_meters` and `lib.rs` registration. Verify
      `make rust-check`; confirm no changes inside either cpal callback.
- [x] **Step 3 — Frontend bridge + hook.** Add `getMeters()` and `useMeters`. Verify `npm run build`
      / lint.
- [x] **Step 4 — UI.** Add `LevelMeter` instances at the lateral edges of `.knob-row` in `AmpPanel`;
      pass the snapshot from `App`. Check the 1200×650 layout, idle state, and that nothing scrolls.
- [ ] **Step 5 — QA + docs.** Update README. Manual checklist below.
  Note: full `cargo test` has one pre-existing, unrelated failure —
  `model_manager::tests::loads_real_nam_and_processes_audio` expects a local
  `nams/JCM800 Hi P6 B8 M4 T7 G2.nam` fixture that is absent from this checkout.
  `cargo test level_meter` passes (6/6).

### Manual QA checklist
- Power on → play → both bars move; numbers and peak-hold track the signal.
- Turn the **Input** knob → `IN` stays put, `OUT` changes (proves the pre-trim tap).
- Engage the gate → `IN` still shows quiet passages while `OUT` drops.
- Hard strum → clip dot latches for ~1 s; peak-hold falls back smoothly.
- Unplug / silence → both bars fall to idle; power off → zeroed readouts; power cycle → no stale frames.
- No NAM/IR loaded (bypass) → `IN` still works.
- Open Library → polling stops (no IPC churn); back to amp → meters resume.
- `AudioStatusBar` xrun count stays flat with meters live.

### Open decisions (resolve during implementation)
- **Exact scale labels/colours**: the reference image appears to use `0…-60` with green/gold/red
  segments; confirm tick spacing and the two numeric readouts against the image while styling.
- **RMS window**: ~100 ms is a compromise between bass-note stability and responsiveness; 50 ms is
  snappier but bouncier.
- **Output clip semantics**: with `soft_clip` limiting, use the same -0.1 dBFS latch as a
  "limiter working" hint, or relabel that dot `LIMIT` for `OUT`.
- **Publish cadence**: every block (~200 Hz) with `try_lock()`; if frames are dropped under load,
  publish every other block — no frontend change needed.
- **Meter row height vs. knob row**: if the panel gets too tall at 650 px, reduce the row to ~100 px
  or move the meters into a compact right-hand column and shrink the knobs.
