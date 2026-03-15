// ── Settings ──

export interface ChildConfig {
  id: string;
  name: string;
}

export interface AppSettings {
  school_id: string;
  children: ChildConfig[];
  output_dir: string;
  concurrency: number;
  safe_mode: boolean;
}

// ── Job ──

export type JobStatus =
  | "queued"
  | "authenticating"
  | "scanning"
  | "enumerating"
  | "downloading"
  | "verifying"
  | "paused"
  | "cancelled"
  | "completed"
  | "completed_with_errors"
  | "failed";

// ── Events from backend ──

export type AppEvent =
  | { type: "auth_started" }
  | { type: "auth_completed" }
  | { type: "auth_failed"; message: string }
  | { type: "session_valid" }
  | { type: "session_expired" }
  | { type: "session_check_started" }
  | { type: "scan_started"; child_name: string }
  | {
      type: "scan_progress";
      child_name: string;
      page: number;
      total_pages: number;
      photos_found: number;
    }
  | {
      type: "scan_completed";
      child_name: string;
      total_photos: number;
      new_photos: number;
    }
  | { type: "download_started"; job_id: string; total_items: number }
  | {
      type: "download_item_started";
      item_id: string;
      child_name: string;
      filename: string;
    }
  | {
      type: "download_item_progress";
      item_id: string;
      bytes_downloaded: number;
      bytes_total: number | null;
    }
  | {
      type: "download_item_completed";
      item_id: string;
      child_name: string;
      filename: string;
      dest_path: string;
    }
  | {
      type: "download_item_failed";
      item_id: string;
      child_name: string;
      filename: string;
      reason: FailureReason;
      will_retry: boolean;
    }
  | {
      type: "download_item_skipped";
      item_id: string;
      child_name: string;
      reason: string;
    }
  | {
      type: "job_progress";
      job_id: string;
      status: JobStatus;
      completed: number;
      failed: number;
      skipped: number;
      total: number;
      bytes_downloaded: number;
    }
  | {
      type: "job_completed";
      job_id: string;
      completed: number;
      failed: number;
      skipped: number;
      total: number;
    }
  | { type: "job_failed"; job_id: string; message: string }
  | { type: "job_paused"; job_id: string }
  | { type: "job_resumed"; job_id: string }
  | { type: "job_cancelled"; job_id: string }
  | { type: "warning"; message: string }
  | { type: "retry_scheduled"; item_id: string; attempt: number; delay_ms: number };

export type FailureReason =
  | "network_timeout"
  | { http_error: { status: number } }
  | "integrity_mismatch"
  | "auth_expired"
  | "rate_limited"
  | { io_error: { message: string } }
  | { unknown: { message: string } };

// ── App screen ──

export type Screen =
  | "onboarding"
  | "destination"
  | "auth"
  | "scan_review"
  | "download"
  | "complete"
  | "history"
  | "settings";
