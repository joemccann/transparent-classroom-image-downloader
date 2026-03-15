use tauri::State;

use crate::core::errors::AppError;
use crate::core::models::{AppSettings, ChildConfig};
use crate::state::AppState;

#[tauri::command]
pub async fn save_settings(
    state: State<'_, AppState>,
    school_id: String,
    children: Vec<ChildConfig>,
    output_dir: String,
    concurrency: Option<u8>,
    safe_mode: Option<bool>,
) -> Result<(), AppError> {
    let settings = AppSettings {
        school_id,
        children,
        output_dir,
        concurrency: concurrency.unwrap_or(3),
        safe_mode: safe_mode.unwrap_or(false),
    };

    let storage = state.storage.lock().await;
    storage.save_settings(&settings)?;
    drop(storage);

    // Update cached settings
    let mut cached = state.settings.lock().await;
    *cached = Some(settings);

    Ok(())
}

#[tauri::command]
pub async fn load_settings(state: State<'_, AppState>) -> Result<Option<AppSettings>, AppError> {
    let cached = state.settings.lock().await;
    if cached.is_some() {
        return Ok(cached.clone());
    }
    drop(cached);

    let storage = state.storage.lock().await;
    let settings = storage.load_settings()?;
    drop(storage);

    if let Some(ref s) = settings {
        let mut cached = state.settings.lock().await;
        *cached = Some(s.clone());
    }

    Ok(settings)
}

#[tauri::command]
pub async fn get_download_stats(
    state: State<'_, AppState>,
) -> Result<Vec<(String, u32)>, AppError> {
    let settings = state.settings.lock().await;
    let settings = match settings.as_ref() {
        Some(s) => s.clone(),
        None => return Ok(Vec::new()),
    };
    drop(settings);

    let cached_settings = state.settings.lock().await;
    let children = cached_settings.as_ref().map(|s| s.children.clone()).unwrap_or_default();
    drop(cached_settings);

    let storage = state.storage.lock().await;
    let mut stats = Vec::new();
    for child in &children {
        let count = storage.get_total_downloaded(&child.id)?;
        stats.push((child.name.clone(), count));
    }

    Ok(stats)
}
