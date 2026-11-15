use crate::audio_engine::{AudioEngine, AudioStatus};
use cpal::traits::{DeviceTrait, HostTrait};
use serde::Serialize;
use std::sync::Mutex as StdMutex;
use tauri::State;

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
pub fn set_gain_level(
    engine: State<'_, StdMutex<AudioEngine>>,
    level: u32,
) -> Result<(), String> {
    let engine = engine.lock().map_err(|e| format!("Mutex poisoned: {}", e))?;
    engine.set_gain_level(level);
    Ok(())
}

#[tauri::command]
pub fn set_sensitivity(
    engine: State<'_, StdMutex<AudioEngine>>,
    sensitivity: String,
) -> Result<(), String> {
    let engine = engine.lock().map_err(|e| format!("Mutex poisoned: {}", e))?;
    engine.set_sensitivity(&sensitivity);
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
pub fn list_nam_models(
    engine: State<'_, StdMutex<AudioEngine>>,
) -> Vec<String> {
    let engine = engine.lock().unwrap();
    engine.nam_model_names()
}

#[tauri::command]
pub fn set_nam_model(
    engine: State<'_, StdMutex<AudioEngine>>,
    index: usize,
) -> Result<(), String> {
    let engine = engine.lock().map_err(|e| format!("Mutex poisoned: {}", e))?;
    engine.set_nam_model(index);
    Ok(())
}

#[tauri::command]
pub fn set_buffer_size(
    engine: State<'_, StdMutex<AudioEngine>>,
    size: usize,
) -> Result<(), String> {
    let mut engine = engine.lock().map_err(|e| format!("Mutex poisoned: {}", e))?;
    engine.set_buffer_size(size)
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
