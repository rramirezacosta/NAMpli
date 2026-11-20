use crate::audio_engine::{AudioEngine, AudioStatus};
use cpal::traits::{DeviceTrait, HostTrait};
use serde::Serialize;
use std::sync::Mutex as StdMutex;
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

#[tauri::command]
pub fn set_buffer_size(
    engine: State<'_, StdMutex<AudioEngine>>,
    size: usize,
) -> Result<(), String> {
    let mut engine = engine.lock().map_err(|e| format!("Mutex poisoned: {}", e))?;
    engine.set_buffer_size(size)
}

fn presets_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
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

#[tauri::command]
pub fn list_presets(app: AppHandle) -> Result<Vec<String>, String> {
    let dir = presets_dir(&app)?;
    let mut names = Vec::new();
    for entry in std::fs::read_dir(&dir).map_err(|e| format!("Could not read presets: {}", e))? {
        let entry = entry.map_err(|e| format!("Bad entry: {}", e))?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("json") {
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                names.push(stem.to_string());
            }
        }
    }
    names.sort();
    Ok(names)
}

#[tauri::command]
pub fn save_preset(app: AppHandle, name: String, content: String) -> Result<(), String> {
    let safe = sanitize_preset_name(&name);
    if safe.is_empty() {
        return Err("Preset name is empty".into());
    }
    let dir = presets_dir(&app)?;
    let path = dir.join(format!("{}.json", safe));
    std::fs::write(&path, content).map_err(|e| format!("Could not write preset: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn load_preset(app: AppHandle, name: String) -> Result<String, String> {
    let safe = sanitize_preset_name(&name);
    let dir = presets_dir(&app)?;
    let path = dir.join(format!("{}.json", safe));
    std::fs::read_to_string(&path).map_err(|e| format!("Could not read preset: {}", e))
}

#[tauri::command]
pub fn delete_preset(app: AppHandle, name: String) -> Result<(), String> {
    let safe = sanitize_preset_name(&name);
    let dir = presets_dir(&app)?;
    let path = dir.join(format!("{}.json", safe));
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| format!("Could not delete preset: {}", e))?;
    }
    Ok(())
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
