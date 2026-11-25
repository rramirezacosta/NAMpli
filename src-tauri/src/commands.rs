use crate::audio_engine::{AudioEngine, AudioStatus};
use crate::level_meter::MeterSnapshot;
use cpal::traits::{DeviceTrait, HostTrait};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex as StdMutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};

#[tauri::command]
pub fn list_audio_hosts() -> Vec<String> {
    cpal::available_hosts()
        .iter()
        .map(|h| h.name().to_string())
        .collect()
}

#[tauri::command]
pub fn list_audio_devices(host: Option<String>) -> Result<serde_json::Value, String> {
    let cpal_host = match host.as_deref() {
        Some(name) => {
            let id: cpal::HostId = name
                .parse()
                .map_err(|e| format!("Unknown audio host '{}': {}", name, e))?;
            cpal::host_from_id(id)
                .map_err(|e| format!("Audio host '{}' unavailable: {}", name, e))?
        }
        None => cpal::default_host(),
    };
    let host_name = host.clone().unwrap_or_default();

    let default_input = cpal_host
        .default_input_device()
        .and_then(|d| d.id().ok())
        .map(|id| id.to_string());
    let default_output = cpal_host
        .default_output_device()
        .and_then(|d| d.id().ok())
        .map(|id| id.to_string());

    let inputs = collect_devices(
        cpal_host.input_devices().ok(),
        default_input.as_deref(),
        &host_name,
    );
    let outputs = collect_devices(
        cpal_host.output_devices().ok(),
        default_output.as_deref(),
        &host_name,
    );

    Ok(serde_json::json!({
        "inputs": inputs,
        "outputs": outputs,
        "defaultInput": default_input,
        "defaultOutput": default_output
    }))
}

fn collect_devices(
    devices: Option<impl Iterator<Item = cpal::Device>>,
    default_id: Option<&str>,
    host_name: &str,
) -> Vec<serde_json::Value> {
    // Collect candidates, then collapse entries that share a label (e.g. the
    // many ALSA `front:`/`hw:`/`plughw:`/`surround*:` variants of one card)
    // into a single entry, keeping the most direct (lowest-latency) one.
    let mut candidates: Vec<(String, String, bool, i32)> = Vec::new();

    if let Some(devices) = devices {
        for device in devices {
            let Ok(id) = device.id() else { continue };
            let id = id.to_string();

            // ALSA exposes virtual endpoints like "null" and "sysdefault". "null"
            // is never useful in a guitar app, and "sysdefault" can resolve to a
            // broken dmix plugin when PipeWire owns the hardware.
            if id == "alsa:null"
                || id == "alsa:sysdefault"
                || id.starts_with("alsa:sysdefault:")
            {
                continue;
            }

            let base_label = device
                .description()
                .ok()
                .map(|d| d.name().to_string())
                .unwrap_or_else(|| id.clone());

            let is_jack = host_name.eq_ignore_ascii_case("jack");
            let is_hardware = is_jack
                || id.contains(":hw:")
                || id.contains(":plughw:")
                || id.contains(":front:")
                || id.contains(":surround");

            // Prefer the most direct route when collapsing duplicates.
            let score: i32 = if is_jack {
                100
            } else if id.contains(":plughw:") {
                95
            } else if id.contains(":hw:") {
                85
            } else if id.contains(":front:") {
                75
            } else if id.contains(":hdmi:") || id.contains(":iec958:") {
                65
            } else if id.contains(":default") || id.contains(":pipewire") {
                10
            } else {
                50
            };

            let label = if is_jack {
                format!("{} (JACK)", base_label)
            } else if is_hardware {
                format!("{} (hardware)", base_label)
            } else {
                base_label
            };

            candidates.push((id.clone(), label, default_id == Some(id.as_str()), score));
        }
    }

    // Collapse by label, keeping the highest-scoring candidate.
    let mut best: std::collections::BTreeMap<String, (String, bool, i32)> =
        std::collections::BTreeMap::new();
    for (id, label, is_default, score) in candidates {
        match best.get(&label) {
            Some((_, _, prev_score)) if *prev_score >= score => {}
            _ => {
                best.insert(label.clone(), (id, is_default, score));
            }
        }
    }

    best.into_iter()
        .map(|(label, (id, is_default, _))| {
            serde_json::json!({
                "id": id,
                "label": label,
                "isDefault": is_default,
            })
        })
        .collect()
}

#[tauri::command]
pub fn start_audio(
    engine: State<'_, StdMutex<AudioEngine>>,
    input_device: Option<String>,
    output_device: Option<String>,
) -> Result<(), String> {
    let mut engine = engine.lock().map_err(|e| format!("Mutex poisoned: {}", e))?;
    engine.start(input_device, output_device)
}

#[tauri::command]
pub fn set_audio_devices(
    engine: State<'_, StdMutex<AudioEngine>>,
    input_device: Option<String>,
    output_device: Option<String>,
) -> Result<(), String> {
    let mut engine = engine.lock().map_err(|e| format!("Mutex poisoned: {}", e))?;
    engine.set_devices(input_device, output_device)
}

#[tauri::command]
pub fn set_audio_host(
    engine: State<'_, StdMutex<AudioEngine>>,
    host: Option<String>,
) -> Result<(), String> {
    let mut engine = engine.lock().map_err(|e| format!("Mutex poisoned: {}", e))?;
    engine.set_host(host)
}

#[tauri::command]
pub fn stop_audio(engine: State<'_, StdMutex<AudioEngine>>) -> Result<(), String> {
    let mut engine = engine.lock().map_err(|e| format!("Mutex poisoned: {}", e))?;
    engine.stop();
    Ok(())
}

#[tauri::command]
pub fn set_bass(
    engine: State<'_, StdMutex<AudioEngine>>,
    value: f32,
) -> Result<(), String> {
    let engine = engine.lock().map_err(|e| format!("Mutex poisoned: {}", e))?;
    engine.set_bass(value);
    Ok(())
}

#[tauri::command]
pub fn set_middle(
    engine: State<'_, StdMutex<AudioEngine>>,
    value: f32,
) -> Result<(), String> {
    let engine = engine.lock().map_err(|e| format!("Mutex poisoned: {}", e))?;
    engine.set_middle(value);
    Ok(())
}

#[tauri::command]
pub fn set_treble(
    engine: State<'_, StdMutex<AudioEngine>>,
    value: f32,
) -> Result<(), String> {
    let engine = engine.lock().map_err(|e| format!("Mutex poisoned: {}", e))?;
    engine.set_treble(value);
    Ok(())
}

#[tauri::command]
pub fn set_master_volume(
    engine: State<'_, StdMutex<AudioEngine>>,
    value: f32,
) -> Result<(), String> {
    let engine = engine.lock().map_err(|e| format!("Mutex poisoned: {}", e))?;
    engine.set_master_volume(value);
    Ok(())
}

#[tauri::command]
pub fn set_presence(
    engine: State<'_, StdMutex<AudioEngine>>,
    value: f32,
) -> Result<(), String> {
    let engine = engine.lock().map_err(|e| format!("Mutex poisoned: {}", e))?;
    engine.set_presence(value);
    Ok(())
}

#[tauri::command]
pub fn set_preamp(
    engine: State<'_, StdMutex<AudioEngine>>,
    value: f32,
) -> Result<(), String> {
    let engine = engine.lock().map_err(|e| format!("Mutex poisoned: {}", e))?;
    engine.set_preamp(value);
    Ok(())
}

#[tauri::command]
pub fn set_noise_gate(
    engine: State<'_, StdMutex<AudioEngine>>,
    enabled: bool,
    threshold_db: f32,
    decay_ms: f32,
) -> Result<(), String> {
    let engine = engine.lock().map_err(|e| format!("Mutex poisoned: {}", e))?;
    engine.set_noise_gate(enabled, threshold_db, decay_ms);
    Ok(())
}

#[tauri::command]
pub fn load_ir(
    engine: State<'_, StdMutex<AudioEngine>>,
    path: String,
) -> Result<String, String> {
    let engine = engine.lock().map_err(|e| format!("Mutex poisoned: {}", e))?;
    engine.load_ir(&path)
}

#[tauri::command]
pub fn clear_ir(engine: State<'_, StdMutex<AudioEngine>>) -> Result<(), String> {
    let engine = engine.lock().map_err(|e| format!("Mutex poisoned: {}", e))?;
    engine.clear_ir();
    Ok(())
}

/// Return the amp to bypass (used when selecting a slot with no NAM).
#[tauri::command]
pub fn clear_nam(engine: State<'_, StdMutex<AudioEngine>>) -> Result<(), String> {
    let engine = engine.lock().map_err(|e| format!("Mutex poisoned: {}", e))?;
    engine.clear_nam();
    Ok(())
}

#[tauri::command]
pub fn set_ir_mix(
    engine: State<'_, StdMutex<AudioEngine>>,
    value: f32,
) -> Result<(), String> {
    let engine = engine.lock().map_err(|e| format!("Mutex poisoned: {}", e))?;
    engine.set_ir_mix(value);
    Ok(())
}

#[tauri::command]
pub fn set_reverb(
    engine: State<'_, StdMutex<AudioEngine>>,
    value: f32,
) -> Result<(), String> {
    let engine = engine.lock().map_err(|e| format!("Mutex poisoned: {}", e))?;
    engine.set_reverb(value);
    Ok(())
}

#[tauri::command]
pub fn get_audio_status(
    engine: State<'_, StdMutex<AudioEngine>>,
) -> Result<AudioStatus, String> {
    let engine = engine.lock().map_err(|e| format!("Mutex poisoned: {}", e))?;
    Ok(engine.status())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TunerStatus {
    pub hz: f32,
    pub level_db: f32,
}

#[tauri::command]
pub fn get_tuner(
    engine: State<'_, StdMutex<AudioEngine>>,
) -> Result<TunerStatus, String> {
    let engine = engine.lock().map_err(|e| format!("Mutex poisoned: {}", e))?;
    let (hz, level_db) = engine.tuner();
    Ok(TunerStatus { hz, level_db })
}

/// Read-only input/output meter snapshot. The worker publishes it after the
/// audio hand-off; the UI polls it at ~30 Hz.
#[tauri::command]
pub fn get_meters(
    engine: State<'_, StdMutex<AudioEngine>>,
) -> Result<MeterSnapshot, String> {
    let engine = engine.lock().map_err(|e| format!("Mutex poisoned: {}", e))?;
    Ok(engine.meters())
}

#[tauri::command]
pub fn set_buffer_size(
    engine: State<'_, StdMutex<AudioEngine>>,
    size: usize,
) -> Result<(), String> {
    let mut engine = engine.lock().map_err(|e| format!("Mutex poisoned: {}", e))?;
    engine.set_buffer_size(size)
}

// ---------------------------------------------------------------------------
// Presets. A preset captures exactly three things: knob state, a NAM model and
// an IR. The model/IR files live in a local library so presets survive restarts.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetRef {
    /// Relative path inside app_data/library, e.g. "nams/ab12cd34/JCM800.nam".
    pub id: String,
    /// Display name, e.g. "JCM800.nam".
    pub name: String,
}

fn default_knob() -> f32 {
    5.0
}

fn zero() -> f32 {
    0.0
}

fn default_schema_version() -> u32 {
    1
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RigSnapshot {
    #[serde(default = "default_knob")]
    pub input_volume: f32,
    #[serde(default = "zero")]
    pub gate: f32,
    #[serde(default = "default_knob")]
    pub bass: f32,
    #[serde(default = "default_knob")]
    pub middle: f32,
    #[serde(default = "default_knob")]
    pub treble: f32,
    #[serde(default = "default_knob")]
    pub output_volume: f32,
    /// Reverb knob, 0..10 (0 = off). Older presets default to off.
    #[serde(default = "zero")]
    pub reverb: f32,
    #[serde(default)]
    pub model: Option<AssetRef>,
    #[serde(default)]
    pub ir: Option<AssetRef>,
}

impl Default for RigSnapshot {
    fn default() -> Self {
        RigSnapshot {
            input_volume: 5.0,
            gate: 0.0,
            bass: 5.0,
            middle: 5.0,
            treble: 5.0,
            output_volume: 5.0,
            reverb: 0.0,
            model: None,
            ir: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetPayload {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    pub name: String,
    pub bank: String,
    pub slot: u8,
    #[serde(default)]
    pub updated_at: u64,
    #[serde(default)]
    pub rig: RigSnapshot,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetMeta {
    pub name: String,
    pub bank: String,
    pub slot: u8,
    pub model_name: Option<String>,
    pub ir_name: Option<String>,
    pub updated_at: u64,
}

/// Legacy preset files held a flat JSON string with a `modelIndex` and the knob
/// values at the top level. Migrate those to the new nested structure.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyPreset {
    #[serde(default = "default_knob")]
    input_volume: f32,
    #[serde(default = "zero")]
    gate: f32,
    #[serde(default = "default_knob")]
    bass: f32,
    #[serde(default = "default_knob")]
    middle: f32,
    #[serde(default = "default_knob")]
    treble: f32,
    #[serde(default = "default_knob")]
    output_volume: f32,
}

#[derive(Serialize, Deserialize, Default)]
struct PresetIndex {
    #[serde(default)]
    entries: Vec<PresetIndexEntry>,
}

#[derive(Serialize, Deserialize, Clone)]
struct PresetIndexEntry {
    name: String,
    bank: String,
    slot: u8,
}

fn presets_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Could not resolve app data dir: {}", e))?
        .join("presets");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Could not create presets dir: {}", e))?;
    Ok(dir)
}

fn sanitize_preset_name(name: &str) -> String {
    name.chars()
        .filter(|c| c.is_alphanumeric() || *c == '_' || *c == '-' || *c == ' ')
        .collect::<String>()
        .trim()
        .to_string()
}

fn index_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(presets_dir(app)?.join("index.json"))
}

fn load_index(app: &AppHandle) -> Result<PresetIndex, String> {
    let path = index_path(app)?;
    if !path.exists() {
        return Ok(PresetIndex::default());
    }
    let raw = std::fs::read_to_string(&path).map_err(|e| format!("Could not read preset index: {}", e))?;
    serde_json::from_str(&raw).map_err(|e| format!("Could not parse preset index: {}", e))
}

fn save_index(app: &AppHandle, index: &PresetIndex) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(index).map_err(|e| e.to_string())?;
    std::fs::write(index_path(app)?, raw).map_err(|e| format!("Could not write preset index: {}", e))
}

/// Reconcile the index with the files on disk, migrating legacy presets. New
/// files are assigned the next free slot in the 4x4 grid (banks A-D, slots 1-4).
fn sync_index(app: &AppHandle) -> Result<PresetIndex, String> {
    let dir = presets_dir(app)?;
    let mut index = load_index(app)?;
    index
        .entries
        .retain(|entry| dir.join(format!("{}.json", entry.name)).exists());

    let mut files: Vec<String> = Vec::new();
    for entry in std::fs::read_dir(&dir).map_err(|e| format!("Could not read presets: {}", e))? {
        let entry = entry.map_err(|e| format!("Bad entry: {}", e))?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
            if stem == "index" || index.entries.iter().any(|e| e.name == stem) {
                continue;
            }
            files.push(stem.to_string());
        }
    }
    files.sort();

    let mut used: Vec<(String, u8)> = index
        .entries
        .iter()
        .map(|e| (e.bank.clone(), e.slot))
        .collect();
    let mut cursor = 0usize;
    for name in files {
        let mut assigned: Option<(String, u8)> = None;
        while cursor < 16 {
            let bank = ["A", "B", "C", "D"][cursor / 4];
            let slot = (cursor % 4 + 1) as u8;
            cursor += 1;
            if !used.contains(&(bank.to_string(), slot)) {
                assigned = Some((bank.to_string(), slot));
                break;
            }
        }
        // More than 16 presets: keep them in the library with an out-of-grid slot.
        let (bank, slot) = assigned.unwrap_or_else(|| ("A".to_string(), 100 + used.len() as u8));
        used.push((bank.clone(), slot));
        index.entries.push(PresetIndexEntry { name, bank, slot });
    }
    save_index(app, &index)?;
    Ok(index)
}

fn preset_path(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    let safe = sanitize_preset_name(name);
    if safe.is_empty() {
        return Err("Preset name is empty".into());
    }
    Ok(presets_dir(app)?.join(format!("{}.json", safe)))
}

fn parse_preset_json(raw: &str, name: &str) -> Result<PresetPayload, String> {
    let value: serde_json::Value =
        serde_json::from_str(raw).map_err(|e| format!("Could not parse preset '{}': {}", name, e))?;

    if value.get("rig").is_some() {
        return serde_json::from_value(value).map_err(|e| e.to_string());
    }

    // Legacy flat blob: keep the knob values, drop the obsolete built-in model index.
    let legacy: LegacyPreset = serde_json::from_value(value).map_err(|e| e.to_string())?;
    Ok(PresetPayload {
        schema_version: 1,
        name: sanitize_preset_name(name),
        bank: "A".into(),
        slot: 0,
        updated_at: 0,
        rig: RigSnapshot {
            input_volume: legacy.input_volume,
            gate: legacy.gate,
            bass: legacy.bass,
            middle: legacy.middle,
            treble: legacy.treble,
            output_volume: legacy.output_volume,
            reverb: 0.0,
            model: None,
            ir: None,
        },
    })
}

fn read_preset(app: &AppHandle, name: &str) -> Result<PresetPayload, String> {
    let raw = std::fs::read_to_string(preset_path(app, name)?)
        .map_err(|e| format!("Could not read preset '{}': {}", name, e))?;
    parse_preset_json(&raw, name)
}

fn write_preset(app: &AppHandle, preset: &PresetPayload) -> Result<(), String> {
    let safe = sanitize_preset_name(&preset.name);
    if safe.is_empty() {
        return Err("Preset name is empty".into());
    }
    if !matches!(preset.bank.as_str(), "A" | "B" | "C" | "D") {
        return Err(format!("Unknown bank '{}'", preset.bank));
    }
    if !(1..=4).contains(&preset.slot) {
        return Err("Slot must be between 1 and 4".into());
    }

    let mut index = sync_index(app)?;
    if let Some(other) = index
        .entries
        .iter()
        .find(|e| e.bank == preset.bank && e.slot == preset.slot && e.name != safe)
    {
        return Err(format!("Slot {}{} holds '{}'", preset.bank, preset.slot, other.name));
    }
    if let Some(entry) = index.entries.iter_mut().find(|e| e.name == safe) {
        entry.bank = preset.bank.clone();
        entry.slot = preset.slot;
    } else {
        index.entries.push(PresetIndexEntry {
            name: safe.clone(),
            bank: preset.bank.clone(),
            slot: preset.slot,
        });
    }
    save_index(app, &index)?;

    let mut stored = preset.clone();
    stored.name = safe.clone();
    stored.schema_version = 1;
    stored.updated_at = now_millis();
    let raw = serde_json::to_string_pretty(&stored).map_err(|e| e.to_string())?;
    std::fs::write(preset_path(app, &safe)?, raw).map_err(|e| format!("Could not write preset: {}", e))
}

fn meta_for(app: &AppHandle, entry: &PresetIndexEntry) -> Option<PresetMeta> {
    let preset = read_preset(app, &entry.name).ok()?;
    Some(PresetMeta {
        name: preset.name,
        bank: entry.bank.clone(),
        slot: entry.slot,
        model_name: preset.rig.model.map(|a| a.name),
        ir_name: preset.rig.ir.map(|a| a.name),
        updated_at: preset.updated_at,
    })
}

#[tauri::command]
pub fn list_presets(app: AppHandle) -> Result<Vec<PresetMeta>, String> {
    let index = sync_index(&app)?;
    Ok(index.entries.iter().filter_map(|e| meta_for(&app, e)).collect())
}

#[tauri::command]
pub fn save_preset(app: AppHandle, preset: PresetPayload) -> Result<(), String> {
    write_preset(&app, &preset)
}

/// Load (or clear) the NAM and IR referenced by a rig snapshot into the engine.
/// Shared by preset recall, snapshot recall and audition revert so all three
/// restore the *audio* state as well as the React/knob state.
fn apply_rig_assets(
    app: &AppHandle,
    engine: &mut AudioEngine,
    rig: &RigSnapshot,
) -> Result<(), String> {
    // Hold one mute across the whole recall so loading the NAM and then the IR
    // does not bounce the output back up between the two swaps. Nested guard
    // requests in the engine methods reuse this one.
    let _mute = engine.mute_guard();
    match &rig.model {
        Some(asset) => {
            let path = resolve_asset_path(app, &asset.id)?;
            let bytes = std::fs::read(&path)
                .map_err(|e| format!("Could not read preset NAM '{}': {}", asset.name, e))?;
            engine.load_nam_from_bytes(&asset.name, bytes)?;
        }
        None => engine.clear_nam(),
    }
    match &rig.ir {
        Some(asset) => {
            let path = resolve_asset_path(app, &asset.id)?;
            engine.load_ir(&path.to_string_lossy())?;
        }
        None => engine.clear_ir(),
    }
    Ok(())
}

#[tauri::command]
pub fn load_preset(
    app: AppHandle,
    engine: State<'_, StdMutex<AudioEngine>>,
    name: String,
) -> Result<PresetPayload, String> {
    let preset = read_preset(&app, &name)?;
    let mut engine = engine.lock().map_err(|e| format!("Mutex poisoned: {}", e))?;
    apply_rig_assets(&app, &mut engine, &preset.rig)?;
    Ok(preset)
}

/// Restore an arbitrary rig's NAM/IR from the local asset library. Used when an
/// audition is reverted to unsaved working state.
#[tauri::command]
pub fn load_rig_assets(
    app: AppHandle,
    engine: State<'_, StdMutex<AudioEngine>>,
    rig: RigSnapshot,
) -> Result<(), String> {
    let mut engine = engine.lock().map_err(|e| format!("Mutex poisoned: {}", e))?;
    apply_rig_assets(&app, &mut engine, &rig)
}

/// Read-only preset access for the library's Copy action: no engine side effects.
#[tauri::command]
pub fn get_preset(app: AppHandle, name: String) -> Result<PresetPayload, String> {
    read_preset(&app, &name)
}

/// Relocate a preset to another bank/slot, optionally replacing the occupant.
#[tauri::command]
pub fn move_preset(
    app: AppHandle,
    name: String,
    bank: String,
    slot: u8,
    replace: bool,
) -> Result<(), String> {
    if !matches!(bank.as_str(), "A" | "B" | "C" | "D") {
        return Err(format!("Unknown bank '{}'", bank));
    }
    if !(1..=4).contains(&slot) {
        return Err("Slot must be between 1 and 4".into());
    }
    let safe = sanitize_preset_name(&name);
    let mut index = sync_index(&app)?;
    let occupant = index
        .entries
        .iter()
        .find(|e| e.bank == bank && e.slot == slot && e.name != safe)
        .map(|e| e.name.clone());
    if let Some(other) = &occupant {
        if !replace {
            return Err(format!("Slot {}{} holds '{}'", bank, slot, other));
        }
    }
    let entry = index
        .entries
        .iter_mut()
        .find(|e| e.name == safe)
        .ok_or_else(|| format!("Preset '{}' not found", safe))?;
    entry.bank = bank.clone();
    entry.slot = slot;

    let path = preset_path(&app, &safe)?;
    let raw = std::fs::read_to_string(&path)
        .map_err(|e| format!("Could not read preset '{}': {}", safe, e))?;
    let mut preset = parse_preset_json(&raw, &safe)?;
    preset.bank = bank;
    preset.slot = slot;
    preset.updated_at = now_millis();
    let raw = serde_json::to_string_pretty(&preset).map_err(|e| e.to_string())?;
    std::fs::write(&path, raw).map_err(|e| format!("Could not write preset: {}", e))?;

    if let Some(other) = occupant {
        index.entries.retain(|e| e.name != other);
        std::fs::remove_file(preset_path(&app, &other)?)
            .map_err(|e| format!("Could not remove replaced preset: {}", e))?;
    }
    save_index(&app, &index)
}

#[tauri::command]
pub fn delete_preset(app: AppHandle, name: String) -> Result<(), String> {
    let path = preset_path(&app, &name)?;
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| format!("Could not delete preset: {}", e))?;
    }
    let mut index = load_index(&app)?;
    let safe = sanitize_preset_name(&name);
    index.entries.retain(|e| e.name != safe);
    save_index(&app, &index)
}

#[tauri::command]
pub fn rename_preset(app: AppHandle, name: String, new_name: String) -> Result<(), String> {
    let safe_old = sanitize_preset_name(&name);
    let safe_new = sanitize_preset_name(&new_name);
    if safe_new.is_empty() {
        return Err("Preset name is empty".into());
    }
    if safe_old == safe_new {
        return Ok(());
    }
    let from = preset_path(&app, &safe_old)?;
    let to = preset_path(&app, &safe_new)?;
    if to.exists() {
        return Err(format!("A preset named '{}' already exists", safe_new));
    }
    std::fs::rename(&from, &to).map_err(|e| format!("Could not rename preset: {}", e))?;

    let mut preset = read_preset(&app, &safe_new)?;
    preset.name = safe_new.clone();
    let raw = serde_json::to_string_pretty(&preset).map_err(|e| e.to_string())?;
    std::fs::write(&to, raw).map_err(|e| format!("Could not write preset: {}", e))?;

    let mut index = load_index(&app)?;
    if let Some(entry) = index.entries.iter_mut().find(|e| e.name == safe_old) {
        entry.name = safe_new;
    }
    save_index(&app, &index)
}

#[tauri::command]
pub fn export_preset(app: AppHandle, name: String) -> Result<String, String> {
    let preset = read_preset(&app, &name)?;
    serde_json::to_string_pretty(&preset).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn export_preset_to_path(app: AppHandle, name: String, path: String) -> Result<(), String> {
    let preset = read_preset(&app, &name)?;
    let raw = serde_json::to_string_pretty(&preset).map_err(|e| e.to_string())?;
    std::fs::write(&path, raw).map_err(|e| format!("Could not export preset: {}", e))
}

#[tauri::command]
pub fn import_preset(app: AppHandle, json: String) -> Result<PresetMeta, String> {
    let mut preset: PresetPayload =
        serde_json::from_str(&json).map_err(|e| format!("Invalid preset file: {}", e))?;
    preset.schema_version = 1;
    if preset.bank.is_empty() {
        preset.bank = "A".into();
    }
    if preset.slot == 0 {
        preset.slot = 1;
    }
    let name = sanitize_preset_name(&preset.name);
    if name.is_empty() {
        return Err("Preset file has no name".into());
    }
    if preset_path(&app, &name)?.exists() {
        return Err(format!("A preset named '{}' already exists", name));
    }
    write_preset(&app, &preset)?;
    let index = load_index(&app)?;
    index
        .entries
        .iter()
        .find(|e| e.name == name)
        .and_then(|e| meta_for(&app, e))
        .ok_or_else(|| "Could not index imported preset".into())
}

#[tauri::command]
pub fn import_preset_from_path(app: AppHandle, path: String) -> Result<PresetMeta, String> {
    let json = std::fs::read_to_string(&path).map_err(|e| format!("Could not read preset file: {}", e))?;
    import_preset(app, json)
}

// ---------------------------------------------------------------------------
// Local asset library. Files are stored under <library>/<kind>/<hash>/<name>
// so a path's file name is the display name the DSP already reports.
// ---------------------------------------------------------------------------

fn library_dir(app: &AppHandle, kind: &str) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Could not resolve app data dir: {}", e))?
        .join("library")
        .join(kind);
    std::fs::create_dir_all(&dir).map_err(|e| format!("Could not create library dir: {}", e))?;
    Ok(dir)
}

fn library_file_name(filename: &str, kind: &str) -> String {
    let ext = if kind == "nam" { "nam" } else { "wav" };
    let stem = Path::new(filename)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(filename);
    let safe: String = stem
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '_' || *c == '-' || *c == ' ')
        .collect::<String>()
        .trim()
        .to_string();
    format!("{}.{}", if safe.is_empty() { "imported" } else { &safe }, ext)
}

fn resolve_asset_path(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    let relative = Path::new(id);
    if relative.is_absolute()
        || relative
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir | std::path::Component::CurDir))
    {
        return Err(format!("Invalid asset id '{}'", id));
    }
    let root = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Could not resolve app data dir: {}", e))?
        .join("library");
    let path = root.join(relative);
    if !path.exists() {
        return Err(format!("Missing preset asset '{}'", id));
    }
    Ok(path)
}

fn store_asset(app: &AppHandle, kind: &str, filename: &str, bytes: &[u8]) -> Result<AssetRef, String> {
    use sha2::{Digest, Sha256};
    let hash = hex_encode(&Sha256::digest(bytes)[..6]);
    let name = library_file_name(filename, kind);
    let dir = library_dir(app, kind)?.join(&hash);
    std::fs::create_dir_all(&dir).map_err(|e| format!("Could not create asset dir: {}", e))?;
    let path = dir.join(&name);
    if !path.exists() {
        std::fs::write(&path, bytes).map_err(|e| format!("Could not store asset: {}", e))?;
    }
    Ok(AssetRef {
        id: format!("{}/{}/{}", kind, hash, name),
        name,
    })
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

/// Store a copy of a dropped NAM/IR in the library and load it into the engine.
#[tauri::command]
pub fn import_asset(
    app: AppHandle,
    engine: State<'_, StdMutex<AudioEngine>>,
    kind: String,
    filename: String,
    path: Option<String>,
    data: Option<String>,
) -> Result<AssetRef, String> {
    use base64::engine::general_purpose::STANDARD as BASE64;
    use base64::Engine;

    if kind != "nam" && kind != "ir" {
        return Err(format!("Unsupported asset kind '{}'", kind));
    }
    let bytes = if let Some(path) = path {
        std::fs::read(&path).map_err(|e| format!("Could not read '{}': {}", path, e))?
    } else if let Some(data) = data {
        BASE64.decode(&data).map_err(|e| format!("Invalid base64 data: {}", e))?
    } else {
        return Err("No file path or data supplied".into());
    };

    let asset = store_asset(&app, &kind, &filename, &bytes)?;
    let stored = resolve_asset_path(&app, &asset.id)?;
    let stored = stored.to_string_lossy().to_string();
    let engine = engine.lock().map_err(|e| format!("Mutex poisoned: {}", e))?;
    if kind == "nam" {
        engine.load_nam_from_bytes(&asset.name, bytes)?;
    } else {
        engine.load_ir(&stored)?;
    }
    Ok(asset)
}

#[tauri::command]
pub fn toggle_power(engine: State<'_, StdMutex<AudioEngine>>) -> Result<bool, String> {
    let mut engine = engine.lock().map_err(|e| format!("Mutex poisoned: {}", e))?;
    let powered = engine.is_powered();

    if powered {
        engine.stop();
        Ok(false)
    } else {
        engine.start(None, None).map(|_| true)
    }
}

/// Build a safe NAM model name/key from a user-supplied filename.
fn sanitized_nam_name(filename: &str) -> String {
    let stem = filename
        .strip_suffix(".nam")
        .unwrap_or(filename)
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '_' || *c == '-' || *c == ' ')
        .collect::<String>()
        .trim()
        .to_string();
    let stem = if stem.is_empty() { "imported" } else { &stem };
    format!("{}.nam", stem)
}

/// Load a NAM model from base64-encoded bytes (drag-and-drop, in-memory only).
#[tauri::command]
pub fn load_nam_from_bytes(
    engine: State<'_, StdMutex<AudioEngine>>,
    filename: String,
    data: String,
) -> Result<String, String> {
    use base64::engine::general_purpose::STANDARD as BASE64;
    use base64::Engine;

    let final_name = sanitized_nam_name(&filename);

    let bytes = BASE64
        .decode(&data)
        .map_err(|e| format!("Invalid base64 data: {}", e))?;

    let engine = engine.lock().map_err(|e| format!("Mutex poisoned: {}", e))?;
    engine.load_nam_from_bytes(&final_name, bytes)
}

/// Load a NAM model directly from a filesystem path. This is used for native
/// drag-and-drop, where Tauri only exposes the dropped file's path.
#[tauri::command]
pub fn load_nam_from_path(
    engine: State<'_, StdMutex<AudioEngine>>,
    path: String,
) -> Result<String, String> {
    let bytes = std::fs::read(&path)
        .map_err(|e| format!("Could not read NAM file '{}': {}", path, e))?;
    let filename = std::path::Path::new(&path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "imported.nam".to_string());
    let final_name = sanitized_nam_name(&filename);

    let engine = engine.lock().map_err(|e| format!("Mutex poisoned: {}", e))?;
    engine.load_nam_from_bytes(&final_name, bytes)
}

/// Save an IR (WAV) file dropped from the UI into the app_data/irs/ directory.
#[tauri::command]
pub fn save_ir_file(
    app: AppHandle,
    filename: String,
    data: String,
) -> Result<String, String> {
    use base64::engine::general_purpose::STANDARD as BASE64;
    use base64::Engine;

    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Could not resolve app data dir: {}", e))?
        .join("irs");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Could not create irs dir: {}", e))?;

    let safe = filename
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '_' || *c == '-' || *c == ' ')
        .collect::<String>()
        .trim()
        .to_string();
    let name = if safe.is_empty() { "imported" } else { &safe };
    let stem = name.trim().replace(".wav", "");
    let final_name = format!("{}.wav", stem);

    let path = dir.join(&final_name);
    let bytes = BASE64
        .decode(data)
        .map_err(|e| format!("Invalid base64 data: {}", e))?;
    std::fs::write(&path, bytes).map_err(|e| format!("Could not write IR file: {}", e))?;

    Ok(path.to_string_lossy().to_string())
}

/// Log a message to the OS terminal (for frontend debugging).
#[tauri::command]
pub fn log_to_terminal(msg: String) {
    eprintln!("[JS] {}", msg);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preset_round_trip() {
        let preset = PresetPayload {
            schema_version: 1,
            name: "Crunch".into(),
            bank: "A".into(),
            slot: 2,
            updated_at: 42,
            rig: RigSnapshot {
                input_volume: 6.0,
                gate: 3.0,
                bass: 4.0,
                middle: 7.0,
                treble: 8.0,
                output_volume: 5.5,
                reverb: 3.0,
                model: Some(AssetRef { id: "nams/abc/JCM800.nam".into(), name: "JCM800.nam".into() }),
                ir: Some(AssetRef { id: "irs/def/Cab.wav".into(), name: "Cab.wav".into() }),
            },
        };
        let raw = serde_json::to_string(&preset).unwrap();
        let parsed = parse_preset_json(&raw, "Crunch").unwrap();
        assert_eq!(parsed.name, "Crunch");
        assert_eq!(parsed.slot, 2);
        assert_eq!(parsed.rig.middle, 7.0);
        assert_eq!(parsed.rig.reverb, 3.0);
        assert_eq!(parsed.rig.model.unwrap().name, "JCM800.nam");
        assert_eq!(parsed.rig.ir.unwrap().name, "Cab.wav");
    }

    #[test]
    fn legacy_blob_migrates_knobs_and_clears_assets() {
        let legacy = r#"{"modelIndex":3,"inputVolume":7,"gate":2,"bass":9,"middle":4,"treble":6,"outputVolume":8,"bufferSize":256}"#;
        let parsed = parse_preset_json(legacy, "Old").unwrap();
        assert_eq!(parsed.rig.input_volume, 7.0);
        assert_eq!(parsed.rig.bass, 9.0);
        assert_eq!(parsed.rig.reverb, 0.0);
        assert!(parsed.rig.model.is_none());
        assert!(parsed.rig.ir.is_none());
    }

    #[test]
    fn missing_fields_use_defaults() {
        let parsed = parse_preset_json(r#"{"name":"Minimal","bank":"B","slot":1}"#, "Minimal").unwrap();
        assert_eq!(parsed.rig.input_volume, 5.0);
        assert_eq!(parsed.rig.output_volume, 5.0);
        assert_eq!(parsed.rig.reverb, 0.0);
        assert!(parsed.rig.model.is_none());
    }

    #[test]
    fn asset_names_are_sanitised() {
        assert_eq!(library_file_name("My Amp!.nam", "nam"), "My Amp.nam");
        assert_eq!(library_file_name("../../evil.wav", "ir"), "evil.wav");
        assert_eq!(hex_encode(&[0xab, 0x0c]), "ab0c");
    }
}
