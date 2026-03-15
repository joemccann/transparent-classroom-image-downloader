use tauri::State;

use crate::core::errors::AppError;
use crate::state::AppState;

/// Check if there's a valid session stored.
#[tauri::command]
pub async fn check_session(
    state: State<'_, AppState>,
) -> Result<bool, AppError> {
    let settings = state.settings.lock().await;
    let school_id = match settings.as_ref() {
        Some(s) => s.school_id.clone(),
        None => return Ok(false),
    };
    drop(settings);

    let orchestrator = state.orchestrator.lock().await;
    match orchestrator.as_ref() {
        Some(o) => o.check_session(&school_id).await,
        None => Ok(false),
    }
}

/// Called by the frontend after the user completes login in the WebView.
/// `cookies` is the document.cookie string extracted via JS.
#[tauri::command]
pub async fn complete_auth(
    state: State<'_, AppState>,
    cookies: String,
) -> Result<bool, AppError> {
    let settings = state.settings.lock().await;
    let school_id = match settings.as_ref() {
        Some(s) => s.school_id.clone(),
        None => {
            return Err(AppError::ConfigError(
                "Settings must be configured before auth".into(),
            ))
        }
    };
    drop(settings);

    let orchestrator = state.orchestrator.lock().await;
    match orchestrator.as_ref() {
        Some(o) => o.complete_auth(cookies, &school_id).await,
        None => Err(AppError::ConfigError("Orchestrator not initialized".into())),
    }
}

/// Clear stored session.
#[tauri::command]
pub async fn logout(state: State<'_, AppState>) -> Result<(), AppError> {
    let orchestrator = state.orchestrator.lock().await;
    if let Some(o) = orchestrator.as_ref() {
        o.logout()?;
    }
    Ok(())
}

/// Get the login URL for the WebView auth window.
#[tauri::command]
pub fn get_login_url() -> String {
    "https://www.transparentclassroom.com/souls/sign_in".to_string()
}
