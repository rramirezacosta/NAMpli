mod model_manager;
mod audio_engine;
mod commands;
mod eq;
mod ir;
mod level_meter;
mod reverb;
mod tuner;

use audio_engine::AudioEngine;
use model_manager::ModelManager;
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

            // Start with no NAM model loaded (bypass mode)
            let model_manager = ModelManager::new();

            // Create audio engine
            let engine = AudioEngine::new(model_manager);
            app.manage(StdMutex::new(engine));

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_audio_hosts,
            commands::list_audio_devices,
            commands::start_audio,
            commands::set_audio_devices,
            commands::set_audio_host,
            commands::stop_audio,
            commands::set_bass,
            commands::set_middle,
            commands::set_treble,
            commands::set_master_volume,
            commands::set_presence,
            commands::set_preamp,
            commands::set_noise_gate,
            commands::load_ir,
            commands::clear_ir,
            commands::clear_nam,
            commands::set_ir_mix,
            commands::set_reverb,
            commands::get_audio_status,
            commands::get_tuner,
            commands::get_meters,
            commands::set_buffer_size,
            commands::list_presets,
            commands::save_preset,
            commands::load_preset,
            commands::load_rig_assets,
            commands::get_preset,
            commands::list_library_assets,
            commands::move_preset,
            commands::delete_preset,
            commands::rename_preset,
            commands::export_preset,
            commands::export_preset_to_path,
            commands::import_preset,
            commands::import_preset_from_path,
            commands::import_asset,
            commands::list_assets,
            commands::store_asset_file,
            commands::load_asset,
            commands::export_asset_to_path,
            commands::delete_asset,
            commands::rename_asset,
            commands::clean_library,
            commands::toggle_power,
            commands::load_nam_from_bytes,
            commands::load_nam_from_path,
            commands::save_ir_file,
            commands::log_to_terminal,
        ])
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
