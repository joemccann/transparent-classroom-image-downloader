use std::path::PathBuf;

use crate::core::errors::{AppError, AppResult};

const APP_NAME: &str = "tc-downloader";

/// Get the platform-specific application data directory.
/// macOS: ~/Library/Application Support/tc-downloader
/// Linux: ~/.local/share/tc-downloader
/// Windows: %APPDATA%/tc-downloader
pub fn app_data_dir() -> AppResult<PathBuf> {
    dirs::data_dir()
        .map(|d| d.join(APP_NAME))
        .ok_or_else(|| AppError::ConfigError("Could not determine app data directory".into()))
}

/// Get the database file path.
pub fn db_path() -> AppResult<PathBuf> {
    Ok(app_data_dir()?.join("tc-downloader.db"))
}

/// Get the log directory.
pub fn log_dir() -> AppResult<PathBuf> {
    Ok(app_data_dir()?.join("logs"))
}
