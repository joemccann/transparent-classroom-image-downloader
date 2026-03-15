use std::collections::HashSet;
use std::sync::Arc;

use chrono::Utc;
use tokio::sync::Mutex;
use tracing::info;

use crate::core::auth;
use crate::core::download::{self, DownloadControls};
use crate::core::errors::{AppError, AppResult};
use crate::core::events::AppEvent;
use crate::core::http::TcHttpClient;
use crate::core::models::{AppSettings, DownloadItemStatus, DownloadJob, JobStatus, Photo};
use crate::core::scrape;
use crate::core::storage::Storage;

/// Download concurrency: how many photos to download simultaneously.
const DOWNLOAD_CONCURRENCY: usize = 10;

/// Function type for fetching HTML via the WebView (which has session cookies).
pub type PageFetcher = Arc<dyn Fn(String) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<String, String>> + Send>> + Send + Sync>;

/// The main orchestrator — coordinates auth → scrape → download pipeline.
pub struct Orchestrator {
    storage: Arc<Mutex<Storage>>,
    client: TcHttpClient,
    controls: DownloadControls,
    event_sender: tokio::sync::mpsc::UnboundedSender<AppEvent>,
    page_fetcher: Option<PageFetcher>,
}

impl Orchestrator {
    pub fn new(
        storage: Arc<Mutex<Storage>>,
        safe_mode: bool,
        event_sender: tokio::sync::mpsc::UnboundedSender<AppEvent>,
        controls: DownloadControls,
    ) -> AppResult<Self> {
        let client = TcHttpClient::new(safe_mode)?;
        Ok(Self {
            storage,
            client,
            controls,
            event_sender,
            page_fetcher: None,
        })
    }

    /// Set the page fetcher that uses the WebView to fetch HTML.
    pub fn set_page_fetcher(&mut self, fetcher: PageFetcher) {
        self.page_fetcher = Some(fetcher);
    }

    /// Fetch HTML via WebView (preferred) or fall back to reqwest.
    async fn fetch_html(&self, url: &str) -> AppResult<String> {
        if let Some(ref fetcher) = self.page_fetcher {
            fetcher(url.to_string())
                .await
                .map_err(|e| AppError::NetworkError(format!("WebView fetch failed: {}", e)))
        } else {
            self.client.get_html(url).await
        }
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

    /// Store cookies in the HTTP client and keychain without validation.
    /// Used when cookies come from document.cookie (no HttpOnly cookies).
    pub fn load_cookies_only(&self, cookies: &str, school_id: &str) -> AppResult<()> {
        self.client.load_cookies(cookies)?;
        let _ = auth::create_session(cookies.to_string(), school_id.to_string());
        Ok(())
    }

    /// Logout: clear session from keychain.
    pub fn logout(&self) -> AppResult<()> {
        auth::clear_session_from_keychain()?;
        self.emit(AppEvent::SessionExpired);
        Ok(())
    }

    /// Run the full scan + download pipeline for all configured children.
    /// Phase 1 scans all children in parallel, Phase 2 downloads all photos
    /// in a single high-concurrency pool.
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

        // ── Phase 1: Scan all children in parallel ──
        // Emit ScanStarted for all children upfront
        for child in &settings.children {
            self.emit(AppEvent::ScanStarted {
                child_name: child.name.clone(),
            });
        }

        // Gather known hashes for all children
        let mut child_known_hashes: Vec<HashSet<String>> = Vec::new();
        for child in &settings.children {
            let known = {
                let storage = self.storage.lock().await;
                storage.get_downloaded_hashes(&child.id)?
            };
            child_known_hashes.push(known);
        }

        // Launch parallel scans — one future per child
        let mut scan_futures = Vec::new();
        for (i, child) in settings.children.iter().enumerate() {
            let event_sender = self.event_sender.clone();
            let child_name = child.name.clone();
            let child_id = child.id.clone();
            let school_id = settings.school_id.clone();
            let known_hashes = child_known_hashes[i].clone();
            let page_fetcher = self.page_fetcher.clone();
            let client = self.client.clone();

            let fut = async move {
                let fetch_fn = |url: String| {
                    let fetcher = page_fetcher.clone();
                    let client = client.clone();
                    async move {
                        if let Some(ref f) = fetcher {
                            f(url.clone())
                                .await
                                .map_err(|e| AppError::NetworkError(format!("WebView fetch: {}", e)))
                        } else {
                            client.get_html(&url).await
                        }
                    }
                };

                let child_name_for_progress = child_name.clone();
                let sender = event_sender.clone();

                let scan_result = scrape::scrape_child_photos(
                    &fetch_fn,
                    &school_id,
                    &child_id,
                    &child_name,
                    &known_hashes,
                    move |page, total_pages, photos_found| {
                        let _ = sender.send(AppEvent::ScanProgress {
                            child_name: child_name_for_progress.clone(),
                            page,
                            total_pages,
                            photos_found,
                        });
                    },
                )
                .await?;

                Ok::<_, AppError>((child_name.clone(), scan_result))
            };

            scan_futures.push(fut);
        }

        let scan_results = futures::future::join_all(scan_futures).await;

        // Check for cancellation
        if self.controls.is_cancelled() {
            job.status = JobStatus::Cancelled;
            self.emit(AppEvent::JobCancelled {
                job_id: job.id.clone(),
            });
            let storage = self.storage.lock().await;
            storage.save_job(&job)?;
            return Ok(job);
        }

        // Collect all photos from scan results
        let mut all_photos: Vec<(Photo, String)> = Vec::new();

        for result in scan_results {
            let (child_name, scan_result) = result?;
            let child_photos = scan_result.photos;
            let new_count = child_photos.len() as u32;

            self.emit(AppEvent::ScanCompleted {
                child_name: child_name.clone(),
                total_photos: scan_result.total_expected,
                new_photos: new_count,
            });

            for photo in child_photos {
                all_photos.push((photo, child_name.clone()));
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

        // ── Phase 2: Download all photos in a single high-concurrency pool ──
        job.status = JobStatus::Downloading;
        job.total_items = all_photos.len() as u32;

        self.emit(AppEvent::DownloadStarted {
            job_id: job.id.clone(),
            total_items: job.total_items,
        });

        // Build a merged set of all known hashes across all children
        let mut all_known_hashes = HashSet::new();
        for hashes in &child_known_hashes {
            all_known_hashes.extend(hashes.iter().cloned());
        }

        // Build a map from child_id → child_name for folder routing
        let child_name_map: std::collections::HashMap<String, String> = all_photos
            .iter()
            .map(|(p, name)| (p.child_id.clone(), name.clone()))
            .collect();

        // Flatten all photos into a single list
        let mut photos_to_download: Vec<Photo> = all_photos.into_iter().map(|(p, _)| p).collect();

        let mut total_completed = 0u32;
        let mut total_failed = 0u32;
        let mut total_skipped = 0u32;
        let mut total_bytes = 0u64;

        // Download with automatic retry passes for failed items
        const MAX_RETRY_PASSES: u32 = 3;
        for pass in 0..=MAX_RETRY_PASSES {
            if photos_to_download.is_empty() || self.controls.is_cancelled() {
                break;
            }

            if pass > 0 {
                info!(
                    "Retry pass {}/{}: {} photos to retry",
                    pass, MAX_RETRY_PASSES, photos_to_download.len()
                );
                // Brief delay before retry pass
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            }

            let es = self.event_sender.clone();
            let es2 = self.event_sender.clone();
            let es3 = self.event_sender.clone();
            let es4 = self.event_sender.clone();

            let results = download::download_photos(
                &self.client,
                photos_to_download,
                &settings.output_dir,
                &child_name_map,
                &all_known_hashes,
                DOWNLOAD_CONCURRENCY,
                &self.controls,
                move |item_id: &str, filename: &str| {
                    let _ = es.send(AppEvent::DownloadItemStarted {
                        item_id: item_id.to_string(),
                        child_name: String::new(),
                        filename: filename.to_string(),
                    });
                },
                move |item_id: &str, dest_path: &str, _bytes: u64| {
                    let _ = es2.send(AppEvent::DownloadItemCompleted {
                        item_id: item_id.to_string(),
                        child_name: String::new(),
                        filename: dest_path.to_string(),
                        dest_path: dest_path.to_string(),
                    });
                },
                move |item_id: &str, reason: &crate::core::models::FailureReason, will_retry: bool| {
                    let _ = es3.send(AppEvent::DownloadItemFailed {
                        item_id: item_id.to_string(),
                        child_name: String::new(),
                        filename: String::new(),
                        reason: reason.clone(),
                        will_retry,
                    });
                },
                move |item_id: &str, reason: &str| {
                    let _ = es4.send(AppEvent::DownloadItemSkipped {
                        item_id: item_id.to_string(),
                        child_name: String::new(),
                        reason: reason.to_string(),
                    });
                },
            )
            .await?;

            // Tally results and collect failed photos for retry
            let mut failed_photos = Vec::new();
            {
                let s = self.storage.lock().await;
                for result in results {
                    match result.status {
                        DownloadItemStatus::Completed => {
                            total_completed += 1;
                            total_bytes += result.bytes_downloaded;
                            s.mark_downloaded(
                                &result.photo.hash,
                                &result.photo.child_id,
                                result.dest_path.as_ref().map(|p| p.to_str().unwrap_or("")),
                            )?;
                            // Add to known hashes so retries don't re-download
                            all_known_hashes.insert(result.photo.hash.clone());
                        }
                        DownloadItemStatus::Failed => {
                            failed_photos.push(result.photo);
                        }
                        DownloadItemStatus::Skipped => {
                            total_skipped += 1;
                        }
                        _ => {}
                    }
                }
            }

            // Emit progress after this pass
            self.emit(AppEvent::JobProgress {
                job_id: job.id.clone(),
                status: JobStatus::Downloading,
                completed: total_completed,
                failed: failed_photos.len() as u32,
                skipped: total_skipped,
                total: job.total_items,
                bytes_downloaded: total_bytes,
            });

            if failed_photos.is_empty() {
                break; // All done, no retries needed
            }

            if pass == MAX_RETRY_PASSES {
                // Final pass — count remaining failures
                total_failed = failed_photos.len() as u32;
                info!("{} photos failed after all retry passes", total_failed);
            }

            photos_to_download = failed_photos;
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
            let s = self.storage.lock().await;
            s.save_job(&job)?;
        }

        info!(
            "Job {} finished: {} completed, {} failed, {} skipped",
            job.id, total_completed, total_failed, total_skipped
        );

        Ok(job)
    }
}
