use tauri::State;

use crate::core::errors::AppError;
use crate::state::AppState;

/// Start the download pipeline.
#[tauri::command]
pub async fn start_download(
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let settings = state.settings.lock().await;
    let settings = match settings.as_ref() {
        Some(s) => s.clone(),
        None => {
            return Err(AppError::ConfigError(
                "Settings must be configured before downloading".into(),
            ))
        }
    };
    drop(settings);

    let cached_settings = state.settings.lock().await;
    let s = cached_settings.clone().unwrap();
    drop(cached_settings);

    let orchestrator = state.orchestrator.lock().await;
    let orchestrator = match orchestrator.as_ref() {
        Some(o) => o,
        None => return Err(AppError::ConfigError("Orchestrator not initialized".into())),
    };

    // Run the full pipeline (this is the long-running operation)
    let job = orchestrator.run_download(&s).await?;

    Ok(job.id)
}

/// Pause a running download.
#[tauri::command]
pub async fn pause_download(state: State<'_, AppState>) -> Result<(), AppError> {
    let orchestrator = state.orchestrator.lock().await;
    if let Some(o) = orchestrator.as_ref() {
        o.controls().pause();
    }
    Ok(())
}

/// Resume a paused download.
#[tauri::command]
pub async fn resume_download(state: State<'_, AppState>) -> Result<(), AppError> {
    let orchestrator = state.orchestrator.lock().await;
    if let Some(o) = orchestrator.as_ref() {
        o.controls().resume();
    }
    Ok(())
}

/// Cancel a running download.
#[tauri::command]
pub async fn cancel_download(state: State<'_, AppState>) -> Result<(), AppError> {
    let orchestrator = state.orchestrator.lock().await;
    if let Some(o) = orchestrator.as_ref() {
        o.controls().cancel();
    }
    Ok(())
}

/// Get recent job history.
#[tauri::command]
pub async fn get_job_history(
    state: State<'_, AppState>,
    limit: Option<u32>,
) -> Result<Vec<(String, String, String, u32, u32)>, AppError> {
    let storage = state.storage.lock().await;
    storage.get_recent_jobs(limit.unwrap_or(10))
}

/// Open the output folder in the system file manager.
#[tauri::command]
pub async fn open_output_folder(state: State<'_, AppState>) -> Result<(), AppError> {
    let settings = state.settings.lock().await;
    if let Some(s) = settings.as_ref() {
        let path = &s.output_dir;
        #[cfg(target_os = "macos")]
        {
            std::process::Command::new("open")
                .arg(path)
                .spawn()
                .map_err(|e| AppError::Io(e))?;
        }
        #[cfg(target_os = "windows")]
        {
            std::process::Command::new("explorer")
                .arg(path)
                .spawn()
                .map_err(|e| AppError::Io(e))?;
        }
        #[cfg(target_os = "linux")]
        {
            std::process::Command::new("xdg-open")
                .arg(path)
                .spawn()
                .map_err(|e| AppError::Io(e))?;
        }
    }
    Ok(())
}
