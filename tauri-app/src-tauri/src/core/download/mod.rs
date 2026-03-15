use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;
use std::time::Duration;

use futures::stream::{self, StreamExt};
use rand::Rng;
use tokio::fs;
use tracing::{error, info};

use crate::core::errors::{AppError, AppResult};
use crate::core::http::TcHttpClient;
use crate::core::models::{DownloadItemStatus, FailureReason, Photo};

const MAX_RETRIES: u32 = 3;
const BASE_BACKOFF_MS: u64 = 1000;
const MAX_FILENAME_LEN: usize = 200;

/// Controls for a running download job.
#[derive(Clone)]
pub struct DownloadControls {
    pub paused: Arc<AtomicBool>,
    pub cancelled: Arc<AtomicBool>,
}

impl DownloadControls {
    pub fn new() -> Self {
        Self {
            paused: Arc::new(AtomicBool::new(false)),
            cancelled: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn is_paused(&self) -> bool {
        self.paused.load(Ordering::Relaxed)
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Relaxed)
    }

    pub fn pause(&self) {
        self.paused.store(true, Ordering::Relaxed);
    }

    pub fn resume(&self) {
        self.paused.store(false, Ordering::Relaxed);
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Relaxed);
    }
}

/// Result of downloading a single photo.
#[derive(Debug)]
pub struct DownloadResult {
    pub photo: Photo,
    pub status: DownloadItemStatus,
    pub dest_path: Option<PathBuf>,
    pub bytes_downloaded: u64,
    pub error: Option<FailureReason>,
}

/// Download a batch of photos with bounded parallelism.
pub async fn download_photos(
    client: &TcHttpClient,
    photos: Vec<Photo>,
    output_dir: &str,
    child_name: &str,
    known_hashes: &HashSet<String>,
    concurrency: usize,
    controls: &DownloadControls,
    on_item_start: impl Fn(&str, &str) + Send + Sync,          // (item_id, filename)
    on_item_complete: impl Fn(&str, &str, u64) + Send + Sync,  // (item_id, dest_path, bytes)
    on_item_failed: impl Fn(&str, &FailureReason, bool) + Send + Sync, // (item_id, reason, will_retry)
    on_item_skipped: impl Fn(&str, &str) + Send + Sync,        // (item_id, reason)
) -> AppResult<Vec<DownloadResult>> {
    let base_dir = PathBuf::from(output_dir).join(child_name);
    fs::create_dir_all(&base_dir).await?;

    let completed_count = Arc::new(AtomicU32::new(0));

    let on_item_start = Arc::new(on_item_start);
    let on_item_complete = Arc::new(on_item_complete);
    let on_item_failed = Arc::new(on_item_failed);
    let on_item_skipped = Arc::new(on_item_skipped);

    let results: Vec<DownloadResult> = stream::iter(photos)
        .map(|photo| {
            let client = client.clone();
            let base_dir = base_dir.clone();
            let known = known_hashes.clone();
            let controls = controls.clone();
            let completed = completed_count.clone();
            let on_start = on_item_start.clone();
            let on_complete = on_item_complete.clone();
            let on_failed = on_item_failed.clone();
            let on_skipped = on_item_skipped.clone();

            async move {
                // Check cancellation
                if controls.is_cancelled() {
                    return DownloadResult {
                        photo,
                        status: DownloadItemStatus::Skipped,
                        dest_path: None,
                        bytes_downloaded: 0,
                        error: None,
                    };
                }

                // Wait while paused
                while controls.is_paused() {
                    tokio::time::sleep(Duration::from_millis(500)).await;
                    if controls.is_cancelled() {
                        return DownloadResult {
                            photo,
                            status: DownloadItemStatus::Skipped,
                            dest_path: None,
                            bytes_downloaded: 0,
                            error: None,
                        };
                    }
                }

                // Skip duplicates
                if known.contains(&photo.hash) {
                    on_skipped(&photo.hash, "already downloaded");
                    return DownloadResult {
                        photo,
                        status: DownloadItemStatus::Skipped,
                        dest_path: None,
                        bytes_downloaded: 0,
                        error: None,
                    };
                }

                let filename = build_filename(&photo);
                let year = photo.year.as_deref().unwrap_or("unknown");
                let year_dir = base_dir.join(year);

                if let Err(e) = fs::create_dir_all(&year_dir).await {
                    error!("Failed to create dir {}: {}", year_dir.display(), e);
                    return DownloadResult {
                        photo,
                        status: DownloadItemStatus::Failed,
                        dest_path: None,
                        bytes_downloaded: 0,
                        error: Some(FailureReason::IoError {
                            message: e.to_string(),
                        }),
                    };
                }

                let dest_path = year_dir.join(&filename);

                // Skip if file already exists on disk
                if dest_path.exists() {
                    on_skipped(&photo.hash, "file exists on disk");
                    return DownloadResult {
                        photo,
                        status: DownloadItemStatus::Skipped,
                        dest_path: Some(dest_path),
                        bytes_downloaded: 0,
                        error: None,
                    };
                }

                on_start(&photo.hash, &filename);

                // Download with retry
                let result =
                    download_with_retry(&client, &photo, &dest_path, &on_failed).await;

                match result {
                    Ok(bytes) => {
                        completed.fetch_add(1, Ordering::Relaxed);
                        on_complete(&photo.hash, &dest_path.to_string_lossy(), bytes);
                        DownloadResult {
                            photo,
                            status: DownloadItemStatus::Completed,
                            dest_path: Some(dest_path),
                            bytes_downloaded: bytes,
                            error: None,
                        }
                    }
                    Err(reason) => DownloadResult {
                        photo,
                        status: DownloadItemStatus::Failed,
                        dest_path: None,
                        bytes_downloaded: 0,
                        error: Some(reason),
                    },
                }
            }
        })
        .buffer_unordered(concurrency)
        .collect()
        .await;

    Ok(results)
}

/// Download a single photo with exponential backoff + jitter retry.
async fn download_with_retry(
    client: &TcHttpClient,
    photo: &Photo,
    dest_path: &Path,
    on_failed: &Arc<impl Fn(&str, &FailureReason, bool) + Send + Sync>,
) -> Result<u64, FailureReason> {
    let part_path = dest_path.with_extension("jpg.part");

    for attempt in 0..=MAX_RETRIES {
        match client.download_bytes(&photo.url).await {
            Ok((bytes, content_length)) => {
                // Integrity check
                if let Some(expected) = content_length {
                    if bytes.len() as u64 != expected {
                        let reason = FailureReason::IntegrityMismatch;
                        if attempt < MAX_RETRIES {
                            on_failed(&photo.hash, &reason, true);
                            backoff(attempt).await;
                            continue;
                        }
                        // Clean up part file
                        let _ = fs::remove_file(&part_path).await;
                        return Err(reason);
                    }
                }

                // Write to .part file first
                if let Err(e) = fs::write(&part_path, &bytes).await {
                    let reason = FailureReason::IoError {
                        message: e.to_string(),
                    };
                    if attempt < MAX_RETRIES {
                        on_failed(&photo.hash, &reason, true);
                        backoff(attempt).await;
                        continue;
                    }
                    return Err(reason);
                }

                // Atomic rename
                if let Err(e) = fs::rename(&part_path, dest_path).await {
                    let _ = fs::remove_file(&part_path).await;
                    return Err(FailureReason::IoError {
                        message: e.to_string(),
                    });
                }

                return Ok(bytes.len() as u64);
            }
            Err(AppError::RateLimited { retry_after_secs }) => {
                let reason = FailureReason::RateLimited;
                on_failed(&photo.hash, &reason, attempt < MAX_RETRIES);
                tokio::time::sleep(Duration::from_secs(retry_after_secs)).await;
                continue;
            }
            Err(e) => {
                let reason = FailureReason::Unknown {
                    message: e.to_string(),
                };
                if attempt < MAX_RETRIES {
                    on_failed(&photo.hash, &reason, true);
                    backoff(attempt).await;
                    continue;
                }
                return Err(reason);
            }
        }
    }

    Err(FailureReason::Unknown {
        message: "Max retries exceeded".to_string(),
    })
}

/// Exponential backoff with jitter.
async fn backoff(attempt: u32) {
    let base = BASE_BACKOFF_MS * 2u64.pow(attempt);
    let jitter = rand::thread_rng().gen_range(0..=base / 2);
    let delay = base + jitter;
    info!("Backoff: waiting {}ms (attempt {})", delay, attempt + 1);
    tokio::time::sleep(Duration::from_millis(delay)).await;
}

/// Build a sanitized filename for a photo.
fn build_filename(photo: &Photo) -> String {
    let year = photo.year.as_deref().unwrap_or("unknown");
    let hash_prefix = &photo.hash[..8.min(photo.hash.len())];

    let caption_part = photo
        .caption
        .as_ref()
        .map(|c| {
            let sanitized: String = c
                .chars()
                .filter(|ch| ch.is_alphanumeric() || *ch == ' ' || *ch == '-')
                .collect::<String>()
                .split_whitespace()
                .collect::<Vec<_>>()
                .join("_");
            if sanitized.len() > 50 {
                sanitized[..50].to_string()
            } else {
                sanitized
            }
        })
        .filter(|s| !s.is_empty());

    let name = match caption_part {
        Some(cap) => format!("{}_{}", hash_prefix, cap),
        None => hash_prefix.to_string(),
    };

    let full = format!("{}_{}.jpg", year, name);
    if full.len() > MAX_FILENAME_LEN {
        format!("{}_{}.jpg", year, hash_prefix)
    } else {
        full
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_filename_with_caption() {
        let photo = Photo {
            url: "https://example.com".into(),
            hash: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789".into(),
            year: Some("2026".into()),
            caption: Some("Playing outside".into()),
            child_id: "123".into(),
        };
        let filename = build_filename(&photo);
        assert_eq!(filename, "2026_abcdef01_Playing_outside.jpg");
    }

    #[test]
    fn test_build_filename_without_caption() {
        let photo = Photo {
            url: "https://example.com".into(),
            hash: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789".into(),
            year: Some("2025".into()),
            caption: None,
            child_id: "123".into(),
        };
        let filename = build_filename(&photo);
        assert_eq!(filename, "2025_abcdef01.jpg");
    }

    #[test]
    fn test_build_filename_no_year() {
        let photo = Photo {
            url: "https://example.com".into(),
            hash: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789".into(),
            year: None,
            caption: None,
            child_id: "123".into(),
        };
        let filename = build_filename(&photo);
        assert_eq!(filename, "unknown_abcdef01.jpg");
    }

    #[test]
    fn test_controls() {
        let controls = DownloadControls::new();
        assert!(!controls.is_paused());
        assert!(!controls.is_cancelled());

        controls.pause();
        assert!(controls.is_paused());

        controls.resume();
        assert!(!controls.is_paused());

        controls.cancel();
        assert!(controls.is_cancelled());
    }
}
