mod model_manager;
mod audio_engine;
mod commands;
mod eq;
mod ir;
mod tuner;

use audio_engine::AudioEngine;
use model_manager::ModelManager;
use std::path::PathBuf;
use std::sync::Mutex as StdMutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Find the nams directory
            let nams_dir = if cfg!(debug_assertions) {
                PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../nams")
            } else {
                app.path().resource_dir().unwrap().join("nams")
            };

            log::info!("Loading NAM models from: {}", nams_dir.display());

            // Load all NAM models
            let model_manager = ModelManager::new(&nams_dir)
                .map_err(|e| anyhow::anyhow!("Failed to load NAM models: {}", e))?;

            // Create audio engine
            let engine = AudioEngine::new(model_manager);
            app.manage(StdMutex::new(engine));

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_audio_hosts,
            commands::list_audio_devices,
            commands::list_nam_models,
            commands::set_nam_model,
            commands::start_audio,
            commands::set_audio_devices,
            commands::set_audio_host,
            commands::stop_audio,
            commands::set_gain_level,
            commands::set_sensitivity,
            commands::set_bass,
            commands::set_middle,
            commands::set_treble,
            commands::set_master_volume,
            commands::set_presence,
            commands::set_preamp,
            commands::set_noise_gate,
            commands::load_ir,
            commands::clear_ir,
            commands::set_ir_mix,
            commands::get_audio_status,
            commands::get_tuner,
            commands::set_buffer_size,
            commands::toggle_power,
        ])
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
