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
    let mut result = Vec::new();
    let mut seen = std::collections::HashSet::new();

    if let Some(devices) = devices {
        for device in devices {
            let Ok(id) = device.id() else { continue };
            let id = id.to_string();

            // ALSA exposes virtual endpoints like "null" and "sysdefault". "null"
            // is never useful in a guitar app, and "sysdefault" can resolve to a
            // broken dmix plugin when PipeWire owns the hardware. The working
            // route is usually "alsa:default" (PipeWire) or an explicit "front:"/
            // "hw:" device.
            if id == "alsa:null"
                || id == "alsa:sysdefault"
                || id.starts_with("alsa:sysdefault:")
            {
                continue;
            }
            if !seen.insert(id.clone()) {
                continue;
            }

            let base_label = device
                .description()
                .ok()
                .map(|d| d.name().to_string())
                .unwrap_or_else(|| id.clone());

            // Mark endpoints that bypass the OS mixer so users can pick the
            // lowest-latency route. JACK endpoints are all direct by nature.
            let is_jack = host_name.eq_ignore_ascii_case("jack");
            let is_hardware = is_jack
                || id.contains(":hw:")
                || id.contains(":plughw:")
                || id.contains(":front:")
                || id.contains(":surround");
            let label = if is_jack {
                format!("{} (JACK)", base_label)
            } else if is_hardware {
                format!("{} (hardware)", base_label)
            } else {
                base_label
            };

            result.push(serde_json::json!({
                "id": id,
                "label": label,
                "isDefault": default_id == Some(id.as_str()),
            }));
        }
    }

    result
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
