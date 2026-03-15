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

    // Minimal init script: just update the window title with the current URL.
    // Cookie extraction and children scraping are handled by the Rust polling task
    // via eval() calls, which gives us better timing control.
    let init_script = r#"
        (function() {
            function updateTitle() {
                document.title = window.location.href;
            }
            updateTitle();
            setInterval(updateTitle, 1000);
        })();
    "#;

    // Get screen dimensions for right-half positioning
    let (half_w, full_h, half_x) = {
        let main_win = app.get_webview_window("main");
        match main_win.and_then(|w| w.current_monitor().ok().flatten()) {
            Some(monitor) => {
                let size = monitor.size();
                let scale = monitor.scale_factor();
                let sw = size.width as f64 / scale;
                let sh = size.height as f64 / scale;
                (sw / 2.0, sh, sw / 2.0)
            }
            None => (1024.0, 768.0, 0.0),
        }
    };

    let window = tauri::WebviewWindowBuilder::new(
        &app,
        "auth-login",
        tauri::WebviewUrl::External(
            login_url.parse().expect("hardcoded URL must parse"),
        ),
    )
    .title(login_url)
    .inner_size(half_w, full_h)
    .position(half_x, 0.0)
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
        let mut cookies_sent = false;
        let mut children_scrape_attempts = 0u32;

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

            if !auth_completed {
                continue;
            }

            // Extract school ID from /s/{id}/...
            if !school_id_emitted {
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

            // Send cookies to backend (just store them, skip validation)
            if !cookies_sent {
                println!("[AUTH] poll: extracting cookies via eval");
                let _ = window_clone.eval(
                    r#"
                    (function() {
                        if (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) {
                            window.__TAURI_INTERNALS__.invoke('complete_auth', {
                                cookies: document.cookie
                            });
                        }
                    })();
                    "#,
                );
                cookies_sent = true;
            }

            // Scrape children from DOM via eval — retry up to 10 times
            if children_scrape_attempts < 10 {
                children_scrape_attempts += 1;
                println!("[AUTH] poll: scraping children attempt {}", children_scrape_attempts);
                let _ = window_clone.eval(
                    r#"
                    (function() {
                        var links = document.querySelectorAll('a#child-nav');
                        if (links.length === 0) return;

                        var children = [];
                        for (var i = 0; i < links.length; i++) {
                            var a = links[i];
                            var href = a.getAttribute('href') || '';
                            var name = a.getAttribute('title') || '';
                            var match = href.match(/\/children\/(\d+)/);
                            if (match && name) {
                                children.push({ id: match[1], name: name });
                            }
                        }

                        if (children.length > 0 && window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) {
                            window.__TAURI_INTERNALS__.invoke('notify_children_detected', {
                                childrenJson: JSON.stringify(children)
                            });
                        }
                    })();
                    "#,
                );
                // We'll set children_scraped = true when the event comes back.
                // For now, just keep trying on each poll cycle.
            }
        }
    });

    Ok(())
}

/// Called from the auth webview to store cookies.
/// Stores cookies in the HTTP client and keychain without validation
/// (document.cookie can't access HttpOnly session cookies, so validation
/// would always fail). The URL polling task is the authoritative auth detector.
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

    // Load cookies into the HTTP client (even partial cookies help)
    let orchestrator = state.orchestrator.lock().await;
    if let Some(o) = orchestrator.as_ref() {
        let _ = o.load_cookies_only(&cookies, &school_id);
    }

    Ok(true)
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

/// Called from the auth webview init script when child-nav links are found in the DOM.
#[tauri::command]
pub fn notify_children_detected(
    app: AppHandle,
    children_json: String,
) -> Result<(), String> {
    println!("[AUTH] notify_children_detected: {}", children_json);

    #[derive(serde::Deserialize)]
    struct RawChild {
        id: String,
        name: String,
    }

    let raw: Vec<RawChild> = serde_json::from_str(&children_json)
        .map_err(|e| format!("Failed to parse children JSON: {}", e))?;

    let children: Vec<crate::core::events::DetectedChild> = raw
        .into_iter()
        .map(|c| crate::core::events::DetectedChild {
            id: c.id,
            name: c.name,
        })
        .collect();

    if !children.is_empty() {
        let _ = app.emit(
            "tc-downloader-event",
            AppEvent::ChildrenDetected { children },
        );
    }

    Ok(())
}

/// Called from the WebView after fetch() completes, delivering HTML back to Rust.
#[tauri::command]
pub async fn deliver_page_html(
    app: AppHandle,
    request_id: String,
    html: String,
    error: Option<String>,
) -> Result<(), String> {
    println!("[AUTH] deliver_page_html: request_id={}, html_len={}, error={:?}",
        request_id, html.len(), error);

    let state = app.state::<AppState>();
    let mut pending = state.pending_fetches.lock().await;
    if let Some(sender) = pending.remove(&request_id) {
        match error {
            Some(e) => { let _ = sender.send(Err(e)); }
            None => { let _ = sender.send(Ok(html)); }
        }
    }
    Ok(())
}

/// Get the login URL.
#[tauri::command]
pub fn get_login_url() -> String {
    "https://www.transparentclassroom.com/souls/sign_in".to_string()
}
