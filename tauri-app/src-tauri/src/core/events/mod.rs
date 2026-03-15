use serde::Serialize;

use crate::core::models::{FailureReason, JobStatus};

#[derive(Debug, Clone, Serialize)]
pub struct DetectedChild {
    pub id: String,
    pub name: String,
}

/// All events emitted from backend to frontend.
/// Each variant maps to a Tauri event name.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AppEvent {
    // ── Auth ──
    AuthStarted,
    AuthCompleted,
    AuthFailed {
        message: String,
    },
    SchoolDetected {
        school_id: String,
    },
    ChildPageDetected {
        child_id: String,
    },
    ChildrenDetected {
        children: Vec<DetectedChild>,
    },

    // ── Session ──
    SessionValid,
    SessionExpired,
    SessionCheckStarted,

    // ── Scan ──
    ScanStarted {
        child_name: String,
    },
    ScanProgress {
        child_name: String,
        page: u32,
        total_pages: u32,
        photos_found: u32,
    },
    ScanCompleted {
        child_name: String,
        total_photos: u32,
        new_photos: u32,
    },

    // ── Download ──
    DownloadStarted {
        job_id: String,
        total_items: u32,
    },
    DownloadItemStarted {
        item_id: String,
        child_name: String,
        filename: String,
    },
    DownloadItemProgress {
        item_id: String,
        bytes_downloaded: u64,
        bytes_total: Option<u64>,
    },
    DownloadItemCompleted {
        item_id: String,
        child_name: String,
        filename: String,
        dest_path: String,
    },
    DownloadItemFailed {
        item_id: String,
        child_name: String,
        filename: String,
        reason: FailureReason,
        will_retry: bool,
    },
    DownloadItemSkipped {
        item_id: String,
        child_name: String,
        reason: String,
    },

    // ── Aggregate progress ──
    JobProgress {
        job_id: String,
        status: JobStatus,
        completed: u32,
        failed: u32,
        skipped: u32,
        total: u32,
        bytes_downloaded: u64,
    },

    // ── Terminal ──
    JobCompleted {
        job_id: String,
        completed: u32,
        failed: u32,
        skipped: u32,
        total: u32,
    },
    JobFailed {
        job_id: String,
        message: String,
    },
    JobPaused {
        job_id: String,
    },
    JobResumed {
        job_id: String,
    },
    JobCancelled {
        job_id: String,
    },

    // ── Warnings ──
    Warning {
        message: String,
    },
    RetryScheduled {
        item_id: String,
        attempt: u32,
        delay_ms: u64,
    },
}

impl AppEvent {
    /// The Tauri event channel name for this event.
    pub fn event_name(&self) -> &'static str {
        "tc-downloader-event"
    }
}
