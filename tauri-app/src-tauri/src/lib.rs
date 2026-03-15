mod commands;
mod core;
mod platform;
mod state;

use std::sync::Arc;

use tauri::{Emitter, Manager};
use tokio::sync::Mutex;
use tracing::info;
use tracing_subscriber::EnvFilter;

use crate::core::events::AppEvent;
use crate::core::orchestrator::Orchestrator;
use crate::core::storage::Storage;
use crate::platform::paths;
use crate::state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize logging
    let log_dir = paths::log_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
    std::fs::create_dir_all(&log_dir).ok();

    let file_appender = tracing_appender::rolling::daily(&log_dir, "tc-downloader.log");
    let (non_blocking, _guard) = tracing_appender::non_blocking(file_appender);

    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .with_writer(non_blocking)
        .init();

    info!("TC Downloader starting");

    // Initialize storage
    let db_path = paths::db_path().expect("Failed to determine database path");
    let storage =
        Storage::open(&db_path).expect("Failed to open database");
    let storage = Arc::new(Mutex::new(storage));

    // Load cached settings
    let settings = {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let s = storage.lock().await;
            s.load_settings().unwrap_or(None)
        })
    };

    let settings = Arc::new(Mutex::new(settings));

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .setup(move |app| {
            let handle = app.handle().clone();

            // Create event channel
            let (event_tx, mut event_rx) =
                tokio::sync::mpsc::unbounded_channel::<AppEvent>();

            // Spawn event forwarder to Tauri frontend
            let handle_clone = handle.clone();
            tauri::async_runtime::spawn(async move {
                while let Some(event) = event_rx.recv().await {
                    let _ = handle_clone.emit(event.event_name(), &event);
                }
            });

            // Initialize orchestrator
            let safe_mode = false; // configurable later
            let orchestrator = Orchestrator::new(storage.clone(), safe_mode, event_tx)
                .expect("Failed to create orchestrator");

            let state = AppState {
                storage,
                settings,
                orchestrator: Arc::new(Mutex::new(Some(orchestrator))),
            };

            app.manage(state);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::settings::save_settings,
            commands::settings::load_settings,
            commands::settings::get_download_stats,
            commands::auth::check_session,
            commands::auth::open_auth_window,
            commands::auth::complete_auth,
            commands::auth::logout,
            commands::auth::get_login_url,
            commands::auth::close_auth_window,
            commands::jobs::start_download,
            commands::jobs::pause_download,
            commands::jobs::resume_download,
            commands::jobs::cancel_download,
            commands::jobs::get_job_history,
            commands::jobs::open_output_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
