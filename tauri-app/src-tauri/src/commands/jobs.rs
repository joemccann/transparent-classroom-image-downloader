use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};

use crate::core::errors::AppError;
use crate::core::events::AppEvent;
use crate::core::orchestrator::PageFetcher;
use crate::state::AppState;

static FETCH_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Max retries for a single page fetch when the network fails.
const PAGE_FETCH_MAX_RETRIES: u32 = 5;

/// Base backoff in milliseconds for page fetch retries (doubles each attempt).
const PAGE_FETCH_BASE_BACKOFF_MS: u64 = 2000;

/// Perform a single WebView fetch: eval JS, wait for response via oneshot.
async fn webview_fetch_once(
    window: &tauri::WebviewWindow,
    pending: &Arc<tokio::sync::Mutex<std::collections::HashMap<String, tokio::sync::oneshot::Sender<Result<String, String>>>>>,
    url: &str,
) -> Result<String, String> {
    let request_id = format!("fetch-{}", FETCH_COUNTER.fetch_add(1, Ordering::Relaxed));
    let (tx, rx) = tokio::sync::oneshot::channel();

    {
        let mut map = pending.lock().await;
        map.insert(request_id.clone(), tx);
    }

    let url_json = serde_json::to_string(url).unwrap_or_default();
    let rid_json = serde_json::to_string(&request_id).unwrap_or_default();
    let js = format!(
        r#"(function() {{
    var url = {url_json};
    var rid = {rid_json};
    fetch(url, {{ credentials: 'include' }})
        .then(function(r) {{ return r.text(); }})
        .then(function(html) {{
            if (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) {{
                window.__TAURI_INTERNALS__.invoke('deliver_page_html', {{
                    requestId: rid,
                    html: html,
                    error: null
                }});
            }}
        }})
        .catch(function(e) {{
            if (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) {{
                window.__TAURI_INTERNALS__.invoke('deliver_page_html', {{
                    requestId: rid,
                    html: '',
                    error: e.toString()
                }});
            }}
        }});
}})();"#,
        url_json = url_json,
        rid_json = rid_json,
    );

    window.eval(&js).map_err(|e| format!("eval failed: {}", e))?;

    match tokio::time::timeout(Duration::from_secs(30), rx).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => Err("Response channel closed".to_string()),
        Err(_) => {
            let mut map = pending.lock().await;
            map.remove(&request_id);
            Err("Request timed out".to_string())
        }
    }
}

/// Start the download pipeline.
///
/// Creates a hidden WebView (shares WKWebView cookies with the auth window)
/// to fetch authenticated TC pages, then runs the scrape + download pipeline.
#[tauri::command]
pub async fn start_download(
    app: AppHandle,
) -> Result<String, AppError> {
    println!("[JOBS] start_download called");

    let state = app.state::<AppState>();

    let settings = {
        let s = state.settings.lock().await;
        match s.as_ref() {
            Some(s) => s.clone(),
            None => {
                return Err(AppError::ConfigError(
                    "Settings must be configured before downloading".into(),
                ))
            }
        }
    };

    println!("[JOBS] settings: school={}, children={}, output={}",
        settings.school_id, settings.children.len(), settings.output_dir);

    // Reset download controls for this new job
    state.download_controls.resume();

    // Create a hidden webview for authenticated page fetching.
    // WKWebView shares cookies across all webviews in the same app,
    // so this webview has the session cookies from the auth login.
    if let Some(existing) = app.get_webview_window("page-fetcher") {
        let _ = existing.close();
        tokio::time::sleep(Duration::from_millis(300)).await;
    }

    let fetcher_window = tauri::WebviewWindowBuilder::new(
        &app,
        "page-fetcher",
        tauri::WebviewUrl::External(
            "https://www.transparentclassroom.com"
                .parse()
                .expect("hardcoded URL"),
        ),
    )
    .title("TC Fetcher")
    .visible(false)
    .build()
    .map_err(|e| AppError::NetworkError(format!("Failed to create fetcher window: {}", e)))?;

    // Wait for the hidden webview to load and establish cookies
    println!("[JOBS] waiting for fetcher webview to load...");
    tokio::time::sleep(Duration::from_secs(3)).await;
    println!("[JOBS] fetcher webview ready");

    // Build the page fetcher closure with automatic retry + exponential backoff.
    let pending = state.pending_fetches.clone();
    let fw = fetcher_window.clone();
    let app_handle = app.clone();

    let page_fetcher: PageFetcher = Arc::new(move |url: String| {
        let pending = pending.clone();
        let window = fw.clone();
        let handle = app_handle.clone();
        Box::pin(async move {
            let mut last_error = String::new();

            for attempt in 0..=PAGE_FETCH_MAX_RETRIES {
                if attempt > 0 {
                    let backoff = PAGE_FETCH_BASE_BACKOFF_MS * 2u64.pow(attempt - 1);
                    println!(
                        "[JOBS] page_fetcher: retry {}/{} for {} (waiting {}ms)",
                        attempt, PAGE_FETCH_MAX_RETRIES, url, backoff
                    );
                    // Notify the frontend about the reconnection attempt
                    let _ = handle.emit("tc-downloader-event", &AppEvent::RetryScheduled {
                        item_id: url.clone(),
                        attempt,
                        delay_ms: backoff,
                    });
                    tokio::time::sleep(Duration::from_millis(backoff)).await;
                }

                println!("[JOBS] page_fetcher: requesting {} (attempt {})", url, attempt + 1);

                match webview_fetch_once(&window, &pending, &url).await {
                    Ok(html) => {
                        if attempt > 0 {
                            println!("[JOBS] page_fetcher: recovered after {} retries for {}", attempt, url);
                        }
                        println!(
                            "[JOBS] page_fetcher: got response for {}, len={}",
                            url,
                            html.len()
                        );
                        return Ok(html);
                    }
                    Err(e) => {
                        println!("[JOBS] page_fetcher: attempt {} failed for {}: {}", attempt + 1, url, e);
                        last_error = e;
                    }
                }
            }

            Err(format!(
                "Failed after {} retries: {}",
                PAGE_FETCH_MAX_RETRIES + 1,
                last_error
            ))
        })
    });

    // Set page fetcher on orchestrator and run download
    let mut orchestrator_guard = state.orchestrator.lock().await;
    let orchestrator = match orchestrator_guard.as_mut() {
        Some(o) => o,
        None => {
            let _ = fetcher_window.close();
            return Err(AppError::ConfigError("Orchestrator not initialized".into()));
        }
    };

    orchestrator.set_page_fetcher(page_fetcher);
    let job = orchestrator.run_download(&settings).await;

    // Close the fetcher window regardless of outcome
    let _ = fetcher_window.close();

    let job = job?;
    println!("[JOBS] download complete: job_id={}", job.id);

    Ok(job.id)
}

/// Pause a running download.
#[tauri::command]
pub async fn pause_download(app: AppHandle) -> Result<(), AppError> {
    let state = app.state::<AppState>();
    state.download_controls.pause();
    Ok(())
}

/// Resume a paused download.
#[tauri::command]
pub async fn resume_download(app: AppHandle) -> Result<(), AppError> {
    let state = app.state::<AppState>();
    state.download_controls.resume();
    Ok(())
}

/// Cancel a running download.
#[tauri::command]
pub async fn cancel_download(app: AppHandle) -> Result<(), AppError> {
    let state = app.state::<AppState>();
    state.download_controls.cancel();
    Ok(())
}

/// Get recent job history.
#[tauri::command]
pub async fn get_job_history(
    app: AppHandle,
    limit: Option<u32>,
) -> Result<Vec<(String, String, String, u32, u32)>, AppError> {
    let state = app.state::<AppState>();
    let storage = state.storage.lock().await;
    storage.get_recent_jobs(limit.unwrap_or(10))
}

/// Open the output folder in the system file manager.
#[tauri::command]
pub async fn open_output_folder(app: AppHandle) -> Result<(), AppError> {
    let state = app.state::<AppState>();
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
