use tauri::{AppHandle, Emitter, Manager};
use tracing::info;

use crate::core::errors::AppError;
use crate::core::events::AppEvent;
use crate::state::AppState;

/// Check if there's a valid session stored.
#[tauri::command]
pub async fn check_session(
    app: AppHandle,
) -> Result<bool, AppError> {
    println!("[AUTH] check_session command called");

    let state = app.state::<AppState>();
    let school_id = {
        let settings = state.settings.lock().await;
        match settings.as_ref() {
            Some(s) => s.school_id.clone(),
            None => return Ok(false),
        }
    };

    let orchestrator = state.orchestrator.lock().await;
    let result = match orchestrator.as_ref() {
        Some(o) => o.check_session(&school_id).await,
        None => Ok(false),
    };
    drop(orchestrator);
    println!("[AUTH] check_session result: {:?}", result);
    result
}

/// Open a simple webview window to the TC login page.
/// No init scripts, no polling — just get the page to load.
/// The window title is updated with the current URL so the user can see it.
#[tauri::command]
pub async fn open_auth_window(
    app: AppHandle,
) -> Result<(), String> {
    println!("[AUTH] open_auth_window: entered");

    // Close existing auth window if any
    if let Some(existing) = app.get_webview_window("auth-login") {
        println!("[AUTH] open_auth_window: closing existing window");
        let _ = existing.close();
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }

    let login_url = "https://www.transparentclassroom.com/souls/sign_in";
    println!("[AUTH] open_auth_window: building window for {}", login_url);

    // Simple script: update the window title with the current URL so it acts as a URL bar.
    // Also detect when we leave the login page (auth complete).
    let init_script = r#"
        (function() {
            function updateTitle() {
                document.title = window.location.href;
            }
            updateTitle();
            setInterval(updateTitle, 1000);
        })();
    "#;

    let window = tauri::WebviewWindowBuilder::new(
        &app,
        "auth-login",
        tauri::WebviewUrl::External(
            login_url.parse().expect("hardcoded URL must parse"),
        ),
    )
    .title(login_url)
    .inner_size(1024.0, 768.0)
    .center()
    .resizable(true)
    .initialization_script(init_script)
    .build()
    .map_err(|e| {
        println!("[AUTH] open_auth_window: build FAILED: {}", e);
        e.to_string()
    })?;

    println!("[AUTH] open_auth_window: window built OK, spawning URL monitor");

    // Spawn a simple URL polling task
    let app_clone = app.clone();
    let window_clone = window.clone();

    tauri::async_runtime::spawn(async move {
        let mut auth_completed = false;
        let mut school_id_emitted = false;
        let mut detected_child_ids = std::collections::HashSet::<String>::new();

        loop {
            tokio::time::sleep(std::time::Duration::from_millis(1500)).await;

            let url = match window_clone.url() {
                Ok(u) => u,
                Err(_) => {
                    println!("[AUTH] poll: window closed");
                    if !auth_completed {
                        let _ = app_clone.emit(
                            "tc-downloader-event",
                            AppEvent::AuthFailed {
                                message: "Login window was closed before authentication completed.".to_string(),
                            },
                        );
                    }
                    return;
                }
            };

            let url_str = url.as_str();
            println!("[AUTH] poll: url = {}", url_str);

            let is_login = url_str.contains("/sign_in") || url_str.contains("/login");

            // Detect login completion: navigated away from login page
            if !auth_completed && !is_login && url_str.contains("transparentclassroom.com") {
                println!("[AUTH] poll: LOGIN DETECTED at {}", url_str);
                auth_completed = true;

                let _ = app_clone.emit(
                    "tc-downloader-event",
                    AppEvent::AuthCompleted,
                );
            }

            // Extract school ID from /s/{id}/...
            if auth_completed && !school_id_emitted {
                if let Some(start) = url_str.find("/s/") {
                    let rest = &url_str[start + 3..];
                    if let Some(end) = rest.find('/') {
                        let sid = &rest[..end];
                        if !sid.is_empty() && sid.chars().all(|c| c.is_ascii_digit()) {
                            println!("[AUTH] poll: school_id = {}", sid);
                            let _ = app_clone.emit(
                                "tc-downloader-event",
                                AppEvent::SchoolDetected {
                                    school_id: sid.to_string(),
                                },
                            );
                            school_id_emitted = true;
                        }
                    }
                }
            }

            // Extract child ID from /children/{id}
            if auth_completed {
                if let Some(start) = url_str.find("/children/") {
                    let rest = &url_str[start + 10..];
                    let end = rest.find(|c: char| !c.is_ascii_digit()).unwrap_or(rest.len());
                    let cid = &rest[..end];
                    if !cid.is_empty() && detected_child_ids.insert(cid.to_string()) {
                        println!("[AUTH] poll: child_id = {}", cid);
                        let _ = app_clone.emit(
                            "tc-downloader-event",
                            AppEvent::ChildPageDetected {
                                child_id: cid.to_string(),
                            },
                        );
                    }
                }
            }
        }
    });

    Ok(())
}

/// Called after the user completes login in the WebView.
/// Validates cookies and stores session.
#[tauri::command]
pub async fn complete_auth(
    app: AppHandle,
    cookies: String,
) -> Result<bool, AppError> {
    println!("[AUTH] complete_auth called with {} bytes of cookies", cookies.len());
    info!("complete_auth called with {} bytes of cookies", cookies.len());

    let state = app.state::<AppState>();

    let school_id = {
        let settings = state.settings.lock().await;
        match settings.as_ref() {
            Some(s) => s.school_id.clone(),
            None => "2521".to_string(),
        }
    };

    let orchestrator = state.orchestrator.lock().await;
    match orchestrator.as_ref() {
        Some(o) => {
            let result = o.complete_auth(cookies, &school_id).await?;
            Ok(result)
        }
        None => Err(AppError::ConfigError("Orchestrator not initialized".into())),
    }
}

/// Close the auth window.
#[tauri::command]
pub fn close_auth_window(app: AppHandle) -> Result<(), String> {
    println!("[AUTH] close_auth_window called");
    if let Some(w) = app.get_webview_window("auth-login") {
        w.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Clear stored session.
#[tauri::command]
pub async fn logout(app: AppHandle) -> Result<(), AppError> {
    let state = app.state::<AppState>();
    let orchestrator = state.orchestrator.lock().await;
    if let Some(o) = orchestrator.as_ref() {
        o.logout()?;
    }
    Ok(())
}

/// Get the login URL.
#[tauri::command]
pub fn get_login_url() -> String {
    "https://www.transparentclassroom.com/souls/sign_in".to_string()
}
