use crate::audio_engine::{AudioEngine, AudioStatus};
use crate::level_meter::MeterSnapshot;
use cpal::traits::{DeviceTrait, HostTrait};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
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
    /// Relative path inside app_data/library, e.g. "nam/ab12cd34/JCM800.nam".
    pub id: String,
    /// Display name, e.g. "JCM800.nam".
    pub name: String,
}

/// One row in the asset library view: the stored file plus how much disk it
/// uses and which presets reference it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetMeta {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub size: u64,
    /// Epoch milliseconds of the last modification.
    pub modified: u64,
    /// Names of the presets whose rig references this asset id.
    pub used_by: Vec<String>,
}

/// Older presets used `nams/` and `irs/`; current ids use `nam/` and `ir/`.
/// Normalise both forms so reference counting still finds legacy files.
fn canonical_asset_id(id: &str) -> String {
    if let Some(rest) = id.strip_prefix("nams/") {
        format!("nam/{rest}")
    } else if let Some(rest) = id.strip_prefix("irs/") {
        format!("ir/{rest}")
    } else {
        id.to_string()
    }
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

/// Walk <library>/<kind>/<hash>/<file> and rebuild the ids used by store_asset.
fn asset_refs_in_dir(root: &Path, kind: &str) -> Result<Vec<AssetRef>, String> {
    let extension = if kind == "nam" { "nam" } else { "wav" };
    let mut assets = Vec::new();
    let dirs = match std::fs::read_dir(root) {
        Ok(dirs) => dirs,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(assets),
        Err(err) => return Err(format!("Could not read asset library: {}", err)),
    };
    for dir in dirs {
        let dir = dir.map_err(|e| format!("Could not read asset library: {}", e))?;
        if !dir.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let hash = dir.file_name().to_string_lossy().to_string();
        let files = std::fs::read_dir(dir.path())
            .map_err(|e| format!("Could not read asset folder '{}': {}", hash, e))?;
        for file in files {
            let file = file.map_err(|e| format!("Could not read asset folder '{}': {}", hash, e))?;
            if !file.file_type().map(|t| t.is_file()).unwrap_or(false) {
                continue;
            }
            let name = file.file_name().to_string_lossy().to_string();
            if Path::new(&name)
                .extension()
                .and_then(|ext| ext.to_str())
                .is_none_or(|ext| !ext.eq_ignore_ascii_case(extension))
            {
                continue;
            }
            assets.push(AssetRef {
                id: format!("{}/{}/{}", kind, hash, name),
                name,
            });
        }
    }
    assets.sort_by(|a, b| a.name.cmp(&b.name).then_with(|| a.id.cmp(&b.id)));
    Ok(assets)
}

/// Assets available to the preset editor's NAM/IR pickers (no engine side effects).
#[tauri::command]
pub fn list_library_assets(app: AppHandle, kind: String) -> Result<Vec<AssetRef>, String> {
    if !matches!(kind.as_str(), "nam" | "ir") {
        return Err(format!("Unknown asset kind '{}'", kind));
    }
    asset_refs_in_dir(&library_dir(&app, &kind)?, &kind)
}

/// Map canonical asset ids to the preset names that reference them.
fn usage_from_presets(dir: &Path) -> Result<HashMap<String, Vec<String>>, String> {
    let mut usage: HashMap<String, Vec<String>> = HashMap::new();
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(usage),
        Err(err) => return Err(format!("Could not read presets: {}", err)),
    };
    for entry in entries {
        let entry = entry.map_err(|e| format!("Could not read preset: {}", e))?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let Some(name) = path.file_stem().and_then(|s| s.to_str()).map(str::to_string) else {
            continue;
        };
        if name == "index" {
            continue;
        }
        let raw = match std::fs::read_to_string(&path) {
            Ok(raw) => raw,
            Err(_) => continue,
        };
        let value: serde_json::Value = match serde_json::from_str(&raw) {
            Ok(value) => value,
            Err(_) => continue,
        };
        if let Some(rig) = value.get("rig") {
            for key in ["model", "ir"] {
                if let Some(id) = rig.get(key).and_then(|v| v.get("id")).and_then(|v| v.as_str()) {
                    usage.entry(canonical_asset_id(id)).or_default().push(name.clone());
                }
            }
        }
    }
    Ok(usage)
}

fn preset_asset_usage(app: &AppHandle) -> Result<HashMap<String, Vec<String>>, String> {
    usage_from_presets(&presets_dir(app)?)
}

/// Full asset list for the Library view, including file metadata and usage.
#[tauri::command]
pub fn list_assets(app: AppHandle) -> Result<Vec<AssetMeta>, String> {
    let usage = preset_asset_usage(&app)?;
    let mut out = Vec::new();
    for kind in ["nam", "ir"] {
        let dir = library_dir(&app, kind)?;
        for asset in asset_refs_in_dir(&dir, kind)? {
            let path = resolve_asset_path(&app, &asset.id)?;
            let meta = std::fs::metadata(&path)
                .map_err(|e| format!("Could not stat asset '{}': {}", asset.id, e))?;
            let modified = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            out.push(AssetMeta {
                id: asset.id.clone(),
                name: asset.name,
                kind: kind.to_string(),
                size: meta.len(),
                modified,
                used_by: usage.get(&asset.id).cloned().unwrap_or_default(),
            });
        }
    }
    Ok(out)
}

fn asset_bytes(path: Option<String>, data: Option<String>) -> Result<Vec<u8>, String> {
    use base64::engine::general_purpose::STANDARD as BASE64;
    use base64::Engine;

    if let Some(path) = path {
        std::fs::read(&path).map_err(|e| format!("Could not read '{}': {}", path, e))
    } else if let Some(data) = data {
        BASE64.decode(&data).map_err(|e| format!("Invalid base64 data: {}", e))
    } else {
        Err("No file path or data supplied".into())
    }
}

/// Store a copy of a NAM/IR in the library *without* loading it into the engine.
#[tauri::command]
pub fn store_asset_file(
    app: AppHandle,
    kind: String,
    filename: String,
    path: Option<String>,
    data: Option<String>,
) -> Result<AssetRef, String> {
    if !matches!(kind.as_str(), "nam" | "ir") {
        return Err(format!("Unsupported asset kind '{}'", kind));
    }
    store_asset(&app, &kind, &filename, &asset_bytes(path, data)?)
}

/// Load a stored asset into the engine, without copying or touching presets.
#[tauri::command]
pub fn load_asset(
    app: AppHandle,
    engine: State<'_, StdMutex<AudioEngine>>,
    id: String,
) -> Result<AssetRef, String> {
    let path = resolve_asset_path(&app, &id)?;
    let kind = id.split('/').next().unwrap_or_default();
    let name = path
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| format!("Invalid asset name in '{}'", id))?
        .to_string();
    let engine = engine.lock().map_err(|e| format!("Mutex poisoned: {}", e))?;
    if kind == "nam" {
        let bytes = std::fs::read(&path)
            .map_err(|e| format!("Could not read model '{}': {}", id, e))?;
        engine.load_nam_from_bytes(&name, bytes)?;
    } else if kind == "ir" {
        engine.load_ir(&path.to_string_lossy())?;
    } else {
        return Err(format!("Unknown asset kind in '{}'", id));
    }
    Ok(AssetRef { id, name })
}

/// Copy a stored asset to a user-chosen path (raw NAM/WAV bytes).
#[tauri::command]
pub fn export_asset_to_path(app: AppHandle, id: String, path: String) -> Result<(), String> {
    let src = resolve_asset_path(&app, &id)?;
    std::fs::copy(&src, &path).map_err(|e| format!("Could not export asset: {}", e))?;
    Ok(())
}

/// Replace (or clear) references to `old_id` in every preset using it.
fn rewrite_preset_asset_refs(
    app: &AppHandle,
    old_id: &str,
    replacement: Option<&AssetRef>,
) -> Result<Vec<String>, String> {
    rewrite_refs_in_dir(&presets_dir(app)?, old_id, replacement)
}

fn rewrite_refs_in_dir(
    dir: &Path,
    old_id: &str,
    replacement: Option<&AssetRef>,
) -> Result<Vec<String>, String> {
    let usage = usage_from_presets(dir)?;
    let Some(users) = usage.get(&canonical_asset_id(old_id)) else {
        return Ok(Vec::new());
    };
    let replacement = replacement
        .map(serde_json::to_value)
        .transpose()
        .map_err(|e| e.to_string())?;
    for name in users {
        let target = dir.join(format!("{}.json", sanitize_preset_name(name)));
        let raw = std::fs::read_to_string(&target)
            .map_err(|e| format!("Could not read preset '{}': {}", name, e))?;
        let mut value: serde_json::Value = serde_json::from_str(&raw)
            .map_err(|e| format!("Could not parse preset '{}': {}", name, e))?;
        if let Some(rig) = value.get_mut("rig").and_then(|v| v.as_object_mut()) {
            for key in ["model", "ir"] {
                let matches = rig
                    .get(key)
                    .and_then(|v| v.get("id"))
                    .and_then(|v| v.as_str())
                    .is_some_and(|other| canonical_asset_id(other) == canonical_asset_id(old_id));
                if matches {
                    let next = replacement
                        .clone()
                        .unwrap_or(serde_json::Value::Null);
                    rig.insert(key.to_string(), next);
                }
            }
        }
        let raw = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?;
        std::fs::write(&target, raw)
            .map_err(|e| format!("Could not update preset '{}': {}", name, e))?;
    }
    Ok(users.clone())
}

/// Remove an empty content-hash folder after deleting its last file.
fn remove_empty_asset_folder(path: &Path) {
    if let Some(parent) = path.parent() {
        let empty = std::fs::read_dir(parent)
            .map(|mut entries| entries.next().is_none())
            .unwrap_or(false);
        if empty {
            let _ = std::fs::remove_dir(parent);
        }
    }
}

/// Delete a stored asset. Referenced assets are refused unless `force` is set;
/// forcing strips the reference from every preset that uses it.
#[tauri::command]
pub fn delete_asset(app: AppHandle, id: String, force: Option<bool>) -> Result<Vec<String>, String> {
    let path = resolve_asset_path(&app, &id)?;
    let usage = preset_asset_usage(&app)?;
    let users = usage.get(&canonical_asset_id(&id)).cloned().unwrap_or_default();
    if !users.is_empty() && force != Some(true) {
        return Err(format!("Used by presets: {}", users.join(", ")));
    }
    let affected = rewrite_preset_asset_refs(&app, &id, None)?;
    std::fs::remove_file(&path).map_err(|e| format!("Could not delete asset: {}", e))?;
    remove_empty_asset_folder(&path);
    Ok(affected)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameAssetResult {
    pub asset: AssetRef,
    /// Presets whose asset reference was updated to the new id.
    pub affected: Vec<String>,
}

/// Rename a stored asset and rewrite every preset that references it. The file
/// stays in the same content-hash folder, so only the name (and therefore the
/// id) changes; the frontend reloads the live rig from the returned ref.
#[tauri::command]
pub fn rename_asset(app: AppHandle, id: String, new_name: String) -> Result<RenameAssetResult, String> {
    let old_path = resolve_asset_path(&app, &id)?;
    let kind = id.split('/').next().unwrap_or_default();
    if !matches!(kind, "nam" | "ir") {
        return Err(format!("Unknown asset kind in '{}'", id));
    }
    let name = library_file_name(&new_name, kind);
    let old_name = old_path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or_default()
        .to_string();
    if name == old_name {
        return Ok(RenameAssetResult {
            asset: AssetRef { id, name: old_name },
            affected: Vec::new(),
        });
    }
    let parent = old_path
        .parent()
        .ok_or_else(|| format!("Invalid asset path for '{}'", id))?;
    let hash = parent
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| format!("Invalid asset folder for '{}'", id))?;
    let new_path = parent.join(&name);
    if new_path.exists() {
        return Err(format!("An asset named '{}' already exists", name));
    }
    std::fs::rename(&old_path, &new_path)
        .map_err(|e| format!("Could not rename asset: {}", e))?;
    let new_id = format!("{}/{}/{}", kind, hash, name);
    let asset = AssetRef {
        id: new_id.clone(),
        name: name.clone(),
    };
    let affected = match rewrite_preset_asset_refs(&app, &id, Some(&asset)) {
        Ok(affected) => affected,
        Err(err) => {
            // Best-effort rollback: leave the file under its old name when the
            // preset rewrite failed so references still resolve.
            let _ = std::fs::rename(&new_path, &old_path);
            return Err(err);
        }
    };
    Ok(RenameAssetResult { asset, affected })
}

/// Remove unused assets from the library. `keep` holds ids currently loaded in
/// the live rig, which may not be referenced by any preset yet.
#[tauri::command]
pub fn clean_library(app: AppHandle, keep: Vec<String>) -> Result<Vec<String>, String> {
    let usage = preset_asset_usage(&app)?;
    let keep: HashSet<String> = keep.into_iter().map(|id| canonical_asset_id(&id)).collect();
    let mut removed = Vec::new();
    for kind in ["nam", "ir"] {
        let dir = library_dir(&app, kind)?;
        for asset in asset_refs_in_dir(&dir, kind)? {
            if usage.contains_key(&asset.id) || keep.contains(&asset.id) {
                continue;
            }
            let path = resolve_asset_path(&app, &asset.id)?;
            std::fs::remove_file(&path)
                .map_err(|e| format!("Could not delete asset '{}': {}", asset.id, e))?;
            remove_empty_asset_folder(&path);
            removed.push(asset.name);
        }
    }
    Ok(removed)
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
    if !matches!(kind.as_str(), "nam" | "ir") {
        return Err(format!("Unsupported asset kind '{}'", kind));
    }
    let bytes = asset_bytes(path, data)?;
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

    #[test]
    fn library_assets_keep_store_asset_ids() {
        let root = std::env::temp_dir().join(format!("nampli-assets-test-{}", std::process::id()));
        let folder = root.join("ab12cd34");
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(folder.join("JCM800.nam"), b"model").unwrap();
        std::fs::write(folder.join("ignore.txt"), b"nope").unwrap();

        let assets = asset_refs_in_dir(&root, "nam").unwrap();
        assert_eq!(assets.len(), 1);
        assert_eq!(assets[0].id, "nam/ab12cd34/JCM800.nam");
        assert_eq!(assets[0].name, "JCM800.nam");

        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn legacy_asset_ids_are_canonicalised() {
        assert_eq!(canonical_asset_id("nams/abc/A.nam"), "nam/abc/A.nam");
        assert_eq!(canonical_asset_id("irs/def/B.wav"), "ir/def/B.wav");
        assert_eq!(canonical_asset_id("nam/abc/A.nam"), "nam/abc/A.nam");
    }

    #[test]
    fn preset_usage_counts_legacy_and_current_asset_ids() {
        let dir = std::env::temp_dir().join(format!(
            "nampli-usage-test-{}-{}",
            std::process::id(),
            now_millis()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("Crunch.json"),
            r#"{"name":"Crunch","bank":"A","slot":1,"rig":{"model":{"id":"nams/abc/A.nam","name":"A.nam"},"ir":{"id":"ir/def/B.wav","name":"B.wav"}}}"#,
        )
        .unwrap();
        std::fs::write(dir.join("index.json"), "{}").unwrap();

        let usage = usage_from_presets(&dir).unwrap();
        assert_eq!(usage.get("nam/abc/A.nam").unwrap(), &["Crunch"]);
        assert_eq!(usage.get("ir/def/B.wav").unwrap(), &["Crunch"]);

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn renaming_an_asset_rewrites_preset_references() {
        let dir = std::env::temp_dir().join(format!(
            "nampli-rename-test-{}-{}",
            std::process::id(),
            now_millis()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("Crunch.json"),
            r#"{"name":"Crunch","bank":"A","slot":1,"rig":{"model":{"id":"nams/abc/A.nam","name":"A.nam"},"ir":{"id":"ir/def/B.wav","name":"B.wav"}}}"#,
        )
        .unwrap();

        let renamed = AssetRef {
            id: "nam/abc/Renamed.nam".into(),
            name: "Renamed.nam".into(),
        };
        let affected = rewrite_refs_in_dir(&dir, "nam/abc/A.nam", Some(&renamed)).unwrap();
        assert_eq!(affected, ["Crunch"]);
        let raw = std::fs::read_to_string(dir.join("Crunch.json")).unwrap();
        assert!(raw.contains("Renamed.nam"));
        assert!(!raw.contains("A.nam"));
        assert!(raw.contains("B.wav"));

        std::fs::remove_dir_all(&dir).unwrap();
    }
}
