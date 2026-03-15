use std::sync::Arc;

use tokio::sync::Mutex;

use crate::core::models::AppSettings;
use crate::core::orchestrator::Orchestrator;
use crate::core::storage::Storage;

/// Application state managed by Tauri.
pub struct AppState {
    pub storage: Arc<Mutex<Storage>>,
    pub settings: Arc<Mutex<Option<AppSettings>>>,
    pub orchestrator: Arc<Mutex<Option<Orchestrator>>>,
}
