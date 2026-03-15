use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ── Child / School configuration ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChildConfig {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub school_id: String,
    pub children: Vec<ChildConfig>,
    pub output_dir: String,
    pub concurrency: u8,
    pub safe_mode: bool, // throttled requests
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            school_id: String::new(),
            children: Vec::new(),
            output_dir: String::new(),
            concurrency: 3,
            safe_mode: false,
        }
    }
}

// ── Photo / Album ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Photo {
    pub url: String,
    pub hash: String,
    pub year: Option<String>,
    pub caption: Option<String>,
    pub child_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Album {
    pub child_id: String,
    pub child_name: String,
    pub total_photos: u32,
    pub max_page: u32,
    pub photos: Vec<Photo>,
}

// ── Job lifecycle ──

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JobStatus {
    Queued,
    Authenticating,
    Scanning,
    Enumerating,
    Downloading,
    Verifying,
    Paused,
    Cancelled,
    Completed,
    CompletedWithErrors,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DownloadItemStatus {
    Queued,
    Downloading,
    Completed,
    Failed,
    Skipped,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadItem {
    pub id: String,
    pub job_id: String,
    pub photo: Photo,
    pub status: DownloadItemStatus,
    pub dest_path: Option<String>,
    pub retry_count: u32,
    pub error: Option<String>,
    pub bytes_downloaded: u64,
    pub bytes_total: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadJob {
    pub id: String,
    pub status: JobStatus,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
    pub settings_snapshot: AppSettings,
    pub total_items: u32,
    pub completed_items: u32,
    pub failed_items: u32,
    pub skipped_items: u32,
    pub bytes_downloaded: u64,
}

impl DownloadJob {
    pub fn new(settings: AppSettings) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4().to_string(),
            status: JobStatus::Queued,
            created_at: now,
            updated_at: now,
            completed_at: None,
            settings_snapshot: settings,
            total_items: 0,
            completed_items: 0,
            failed_items: 0,
            skipped_items: 0,
            bytes_downloaded: 0,
        }
    }
}

// ── Auth ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthSession {
    pub cookies: String, // serialized cookie jar
    pub validated_at: DateTime<Utc>,
    pub school_id: String,
}

// ── Failure tracking ──

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FailureReason {
    NetworkTimeout,
    HttpError { status: u16 },
    IntegrityMismatch,
    AuthExpired,
    RateLimited,
    IoError { message: String },
    Unknown { message: String },
}
