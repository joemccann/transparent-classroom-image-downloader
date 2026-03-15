use std::sync::Arc;

use chrono::Utc;
use tokio::sync::Mutex;
use tracing::info;

use crate::core::auth;
use crate::core::download::{self, DownloadControls};
use crate::core::errors::AppResult;
use crate::core::events::AppEvent;
use crate::core::http::TcHttpClient;
use crate::core::models::{AppSettings, DownloadItemStatus, DownloadJob, JobStatus, Photo};
use crate::core::scrape;
use crate::core::storage::Storage;

/// The main orchestrator — coordinates auth → scrape → download pipeline.
pub struct Orchestrator {
    storage: Arc<Mutex<Storage>>,
    client: TcHttpClient,
    controls: DownloadControls,
    event_sender: tokio::sync::mpsc::UnboundedSender<AppEvent>,
}

impl Orchestrator {
    pub fn new(
        storage: Arc<Mutex<Storage>>,
        safe_mode: bool,
        event_sender: tokio::sync::mpsc::UnboundedSender<AppEvent>,
    ) -> AppResult<Self> {
        let client = TcHttpClient::new(safe_mode)?;
        let controls = DownloadControls::new();
        Ok(Self {
            storage,
            client,
            controls,
            event_sender,
        })
    }

    /// Get download controls for pause/resume/cancel.
    pub fn controls(&self) -> &DownloadControls {
        &self.controls
    }

    fn emit(&self, event: AppEvent) {
        let _ = self.event_sender.send(event);
    }

    /// Check if we have a valid session.
    pub async fn check_session(&self, school_id: &str) -> AppResult<bool> {
        self.emit(AppEvent::SessionCheckStarted);
        let valid = auth::validate_session(&self.client, school_id).await?;
        if valid {
            self.emit(AppEvent::SessionValid);
        } else {
            self.emit(AppEvent::SessionExpired);
        }
        Ok(valid)
    }

    /// Store cookies from WebView auth and validate.
    pub async fn complete_auth(
        &self,
        cookies: String,
        school_id: &str,
    ) -> AppResult<bool> {
        self.emit(AppEvent::AuthStarted);

        // Load cookies into the client
        self.client.load_cookies(&cookies)?;

        // Validate the session
        let valid = self.client.check_session(school_id).await?;

        if valid {
            // Store in keychain
            auth::create_session(cookies, school_id.to_string())?;
            self.emit(AppEvent::AuthCompleted);
        } else {
            self.emit(AppEvent::AuthFailed {
                message: "Session cookies did not authenticate successfully".to_string(),
            });
        }

        Ok(valid)
    }

    /// Logout: clear session from keychain.
    pub fn logout(&self) -> AppResult<()> {
        auth::clear_session_from_keychain()?;
        self.emit(AppEvent::SessionExpired);
        Ok(())
    }

    /// Run the full scan + download pipeline for all configured children.
    pub async fn run_download(&self, settings: &AppSettings) -> AppResult<DownloadJob> {
        let mut job = DownloadJob::new(settings.clone());
        job.status = JobStatus::Scanning;

        // Save initial job state
        {
            let storage = self.storage.lock().await;
            storage.save_job(&job)?;
        }

        self.emit(AppEvent::DownloadStarted {
            job_id: job.id.clone(),
            total_items: 0,
        });

        // ── Phase 1: Scan all children ──
        let mut all_photos: Vec<(Photo, String)> = Vec::new(); // (photo, child_name)

        for child in &settings.children {
            if self.controls.is_cancelled() {
                job.status = JobStatus::Cancelled;
                self.emit(AppEvent::JobCancelled {
                    job_id: job.id.clone(),
                });
                let storage = self.storage.lock().await;
                storage.save_job(&job)?;
                return Ok(job);
            }

            self.emit(AppEvent::ScanStarted {
                child_name: child.name.clone(),
            });

            let known_hashes = {
                let storage = self.storage.lock().await;
                storage.get_downloaded_hashes(&child.id)?
            };

            let event_sender = self.event_sender.clone();
            let child_name_clone = child.name.clone();

            let scan_result = scrape::scrape_child_photos(
                &self.client,
                &settings.school_id,
                &child.id,
                &child.name,
                &known_hashes,
                move |page, total_pages, photos_found| {
                    let _ = event_sender.send(AppEvent::ScanProgress {
                        child_name: child_name_clone.clone(),
                        page,
                        total_pages,
                        photos_found,
                    });
                },
            )
            .await?;

            let new_count = scan_result.photos.len() as u32;

            self.emit(AppEvent::ScanCompleted {
                child_name: child.name.clone(),
                total_photos: scan_result.total_expected,
                new_photos: new_count,
            });

            for photo in scan_result.photos {
                all_photos.push((photo, child.name.clone()));
            }
        }

        if all_photos.is_empty() {
            job.status = JobStatus::Completed;
            job.completed_at = Some(Utc::now());
            let storage = self.storage.lock().await;
            storage.save_job(&job)?;
            self.emit(AppEvent::JobCompleted {
                job_id: job.id.clone(),
                completed: 0,
                failed: 0,
                skipped: 0,
                total: 0,
            });
            return Ok(job);
        }

        // ── Phase 2: Download ──
        job.status = JobStatus::Downloading;
        job.total_items = all_photos.len() as u32;

        self.emit(AppEvent::DownloadStarted {
            job_id: job.id.clone(),
            total_items: job.total_items,
        });

        // Group photos by child for parallel downloading
        let mut photos_by_child: std::collections::HashMap<String, (Vec<Photo>, String)> =
            std::collections::HashMap::new();

        for (photo, child_name) in all_photos {
            let child_id = photo.child_id.clone();
            photos_by_child
                .entry(child_id)
                .or_insert_with(|| (Vec::new(), child_name))
                .0
                .push(photo);
        }

        let storage = self.storage.clone();
        let event_sender = self.event_sender.clone();
        let job_id = job.id.clone();

        let mut total_completed = 0u32;
        let mut total_failed = 0u32;
        let mut total_skipped = 0u32;
        let mut total_bytes = 0u64;

        for (child_id, (photos, child_name)) in photos_by_child {
            if self.controls.is_cancelled() {
                break;
            }

            let known_hashes = {
                let s = storage.lock().await;
                s.get_downloaded_hashes(&child_id)?
            };

            let sender = event_sender.clone();
            let sender2 = event_sender.clone();
            let sender3 = event_sender.clone();
            let sender4 = event_sender.clone();
            let child_name2 = child_name.clone();
            let child_name3 = child_name.clone();
            let child_name4 = child_name.clone();

            let results = download::download_photos(
                &self.client,
                photos,
                &settings.output_dir,
                &child_name,
                &known_hashes,
                settings.concurrency as usize,
                &self.controls,
                // on_item_start
                move |item_id: &str, filename: &str| {
                    let _ = sender.send(AppEvent::DownloadItemStarted {
                        item_id: item_id.to_string(),
                        child_name: child_name2.clone(),
                        filename: filename.to_string(),
                    });
                },
                // on_item_complete
                move |item_id: &str, dest_path: &str, _bytes: u64| {
                    let _ = sender2.send(AppEvent::DownloadItemCompleted {
                        item_id: item_id.to_string(),
                        child_name: child_name3.clone(),
                        filename: dest_path.to_string(),
                        dest_path: dest_path.to_string(),
                    });
                },
                // on_item_failed
                move |item_id: &str, reason: &crate::core::models::FailureReason, will_retry: bool| {
                    let _ = sender3.send(AppEvent::DownloadItemFailed {
                        item_id: item_id.to_string(),
                        child_name: child_name4.clone(),
                        filename: String::new(),
                        reason: reason.clone(),
                        will_retry,
                    });
                },
                // on_item_skipped
                move |item_id: &str, reason: &str| {
                    let _ = sender4.send(AppEvent::DownloadItemSkipped {
                        item_id: item_id.to_string(),
                        child_name: String::new(),
                        reason: reason.to_string(),
                    });
                },
            )
            .await?;

            // Update storage and counters
            let s = storage.lock().await;
            for result in &results {
                match result.status {
                    DownloadItemStatus::Completed => {
                        total_completed += 1;
                        total_bytes += result.bytes_downloaded;
                        s.mark_downloaded(
                            &result.photo.hash,
                            &result.photo.child_id,
                            result.dest_path.as_ref().map(|p| p.to_str().unwrap_or("")),
                        )?;
                    }
                    DownloadItemStatus::Failed => total_failed += 1,
                    DownloadItemStatus::Skipped => total_skipped += 1,
                    _ => {}
                }
            }

            // Emit aggregate progress
            self.emit(AppEvent::JobProgress {
                job_id: job_id.clone(),
                status: JobStatus::Downloading,
                completed: total_completed,
                failed: total_failed,
                skipped: total_skipped,
                total: job.total_items,
                bytes_downloaded: total_bytes,
            });
        }

        // ── Phase 3: Finalize ──
        job.completed_items = total_completed;
        job.failed_items = total_failed;
        job.skipped_items = total_skipped;
        job.bytes_downloaded = total_bytes;
        job.updated_at = Utc::now();
        job.completed_at = Some(Utc::now());

        if self.controls.is_cancelled() {
            job.status = JobStatus::Cancelled;
            self.emit(AppEvent::JobCancelled {
                job_id: job.id.clone(),
            });
        } else if total_failed > 0 {
            job.status = JobStatus::CompletedWithErrors;
            self.emit(AppEvent::JobCompleted {
                job_id: job.id.clone(),
                completed: total_completed,
                failed: total_failed,
                skipped: total_skipped,
                total: job.total_items,
            });
        } else {
            job.status = JobStatus::Completed;
            self.emit(AppEvent::JobCompleted {
                job_id: job.id.clone(),
                completed: total_completed,
                failed: total_failed,
                skipped: total_skipped,
                total: job.total_items,
            });
        }

        {
            let s = storage.lock().await;
            s.save_job(&job)?;
        }

        info!(
            "Job {} finished: {} completed, {} failed, {} skipped",
            job.id, total_completed, total_failed, total_skipped
        );

        Ok(job)
    }
}
