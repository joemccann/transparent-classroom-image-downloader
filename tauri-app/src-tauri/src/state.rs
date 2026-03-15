use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::Mutex;

use crate::core::download::DownloadControls;
use crate::core::models::AppSettings;
use crate::core::orchestrator::Orchestrator;
use crate::core::storage::Storage;

/// Application state managed by Tauri.
pub struct AppState {
    pub storage: Arc<Mutex<Storage>>,
    pub settings: Arc<Mutex<Option<AppSettings>>>,
    pub orchestrator: Arc<Mutex<Option<Orchestrator>>>,
    /// Pending WebView fetch requests: request_id → response sender.
    pub pending_fetches: Arc<Mutex<HashMap<String, tokio::sync::oneshot::Sender<Result<String, String>>>>>,
    /// Shared download controls for pause/resume/cancel without locking orchestrator.
    pub download_controls: DownloadControls,
}
