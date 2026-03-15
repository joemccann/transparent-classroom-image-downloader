use thiserror::Error;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("Authentication required: {0}")]
    AuthRequired(String),

    #[error("Authentication failed: {0}")]
    AuthFailed(String),

    #[error("Session expired")]
    SessionExpired,

    #[error("Scraping error: {0}")]
    ScrapeError(String),

    #[error("Markup changed: expected selector '{selector}' not found on {url}")]
    MarkupDrift { selector: String, url: String },

    #[error("Download failed: {0}")]
    DownloadError(String),

    #[error("Download integrity error for {filename}: expected {expected} bytes, got {actual}")]
    IntegrityError {
        filename: String,
        expected: u64,
        actual: u64,
    },

    #[error("Storage error: {0}")]
    StorageError(String),

    #[error("Configuration error: {0}")]
    ConfigError(String),

    #[error("Network error: {0}")]
    NetworkError(String),

    #[error("Rate limited: retry after {retry_after_secs}s")]
    RateLimited { retry_after_secs: u64 },

    #[error("Job cancelled")]
    JobCancelled,

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),

    #[error("SQLite error: {0}")]
    Sqlite(#[from] rusqlite::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Keychain error: {0}")]
    KeychainError(String),
}

// Make AppError serializable for Tauri command responses
impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("AppError", 2)?;
        state.serialize_field("kind", &self.error_kind())?;
        state.serialize_field("message", &self.to_string())?;
        state.end()
    }
}

impl AppError {
    pub fn error_kind(&self) -> &'static str {
        match self {
            Self::AuthRequired(_) => "auth_required",
            Self::AuthFailed(_) => "auth_failed",
            Self::SessionExpired => "session_expired",
            Self::ScrapeError(_) => "scrape_error",
            Self::MarkupDrift { .. } => "markup_drift",
            Self::DownloadError(_) => "download_error",
            Self::IntegrityError { .. } => "integrity_error",
            Self::StorageError(_) => "storage_error",
            Self::ConfigError(_) => "config_error",
            Self::NetworkError(_) => "network_error",
            Self::RateLimited { .. } => "rate_limited",
            Self::JobCancelled => "job_cancelled",
            Self::Io(_) => "io_error",
            Self::Http(_) => "http_error",
            Self::Sqlite(_) => "sqlite_error",
            Self::Json(_) => "json_error",
            Self::KeychainError(_) => "keychain_error",
        }
    }

    /// Redact sensitive information from error messages for logging
    pub fn redacted_message(&self) -> String {
        match self {
            Self::Http(e) => {
                let msg = e.to_string();
                // Redact any cookie or auth header values
                if msg.contains("cookie") || msg.contains("authorization") {
                    "HTTP error: [redacted]".to_string()
                } else {
                    msg
                }
            }
            other => other.to_string(),
        }
    }
}

pub type AppResult<T> = Result<T, AppError>;
