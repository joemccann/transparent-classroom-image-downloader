import { useCallback, useEffect, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AppEvent, FailureReason, JobStatus } from "../types";

export type DownloadPhase = "idle" | "scanning" | "downloading" | "complete" | "failed" | "cancelled";

/** Convert a FailureReason enum to a user-friendly string. */
function formatFailureReason(reason: FailureReason): string {
  if (typeof reason === "string") {
    switch (reason) {
      case "network_timeout": return "Network timed out";
      case "integrity_mismatch": return "File corrupted during download";
      case "auth_expired": return "Session expired";
      case "rate_limited": return "Rate limited — retrying shortly";
      default: return reason;
    }
  }
  if (typeof reason === "object" && reason !== null) {
    if ("http_error" in reason) return `Server error (HTTP ${reason.http_error.status})`;
    if ("io_error" in reason) return `File error: ${reason.io_error.message}`;
    if ("unknown" in reason) return reason.unknown.message;
  }
  return "Unknown error";
}

export interface ScanChildProgress {
  page: number;
  totalPages: number;
  photosFound: number;
}

export interface RetryInfo {
  attempt: number;
  delayMs: number;
  startedAt: number;
}

export interface DownloadProgress {
  phase: DownloadPhase;
  status: JobStatus | null;
  jobId: string | null;
  currentChild: string | null;
  currentFile: string | null;
  completed: number;
  failed: number;
  skipped: number;
  total: number;
  bytesDownloaded: number;
  scanProgress: Map<string, ScanChildProgress>;
  scanTotalFound: number;
  errors: string[];
  isRunning: boolean;
  isComplete: boolean;
  downloadStartedAt: number | null;
  retryInfo: RetryInfo | null;
}

const initialProgress: DownloadProgress = {
  phase: "idle",
  status: null,
  jobId: null,
  currentChild: null,
  currentFile: null,
  completed: 0,
  failed: 0,
  skipped: 0,
  total: 0,
  bytesDownloaded: 0,
  scanProgress: new Map(),
  scanTotalFound: 0,
  errors: [],
  isRunning: false,
  isComplete: false,
  downloadStartedAt: null,
  retryInfo: null,
};

export function useDownloadProgress() {
  const [progress, setProgress] = useState<DownloadProgress>(initialProgress);
  const unlistenRef = useRef<UnlistenFn | null>(null);

  useEffect(() => {
    let mounted = true;

    const setup = async () => {
      const unlisten = await listen<AppEvent>("tc-downloader-event", (event) => {
        if (!mounted) return;
        const data = event.payload;

        setProgress((prev) => {
          switch (data.type) {
            case "session_check_started":
              return { ...prev, isRunning: true };

            case "session_valid":
              return prev;

            case "session_expired":
              return { ...prev, phase: "failed", isRunning: false };

            case "auth_started":
              return prev;

            case "auth_completed":
              return prev;

            case "auth_failed":
              return {
                ...prev,
                phase: "failed",
                errors: [...prev.errors, data.message],
                isRunning: false,
              };

            case "scan_started":
              return {
                ...prev,
                phase: "scanning",
                currentChild: data.child_name,
                isRunning: true,
              };

            case "scan_progress": {
              const newMap = new Map(prev.scanProgress);
              newMap.set(data.child_name, {
                page: data.page,
                totalPages: data.total_pages,
                photosFound: data.photos_found,
              });
              // Sum all children's found photos
              let totalFound = 0;
              newMap.forEach((v) => { totalFound += v.photosFound; });
              return { ...prev, scanProgress: newMap, scanTotalFound: totalFound, retryInfo: null };
            }

            case "scan_completed":
              return prev;

            case "download_started":
              return {
                ...prev,
                phase: "downloading",
                jobId: data.job_id,
                total: data.total_items,
                status: "downloading",
                isRunning: true,
                downloadStartedAt: Date.now(),
              };

            case "download_item_started":
              return {
                ...prev,
                currentChild: data.child_name,
                currentFile: data.filename,
              };

            case "download_item_completed":
              return { ...prev, completed: prev.completed + 1, retryInfo: null };

            case "download_item_failed":
              return {
                ...prev,
                failed: prev.failed + 1,
                errors: data.will_retry
                  ? prev.errors
                  : [...prev.errors, `${data.child_name || "Photo"}: ${formatFailureReason(data.reason)}`],
              };

            case "download_item_skipped":
              return { ...prev, skipped: prev.skipped + 1 };

            case "job_progress":
              return {
                ...prev,
                status: data.status,
                completed: data.completed,
                failed: data.failed,
                skipped: data.skipped,
                total: data.total,
                bytesDownloaded: data.bytes_downloaded,
              };

            case "job_completed":
              return {
                ...prev,
                phase: "complete",
                status: "completed",
                completed: data.completed,
                failed: data.failed,
                skipped: data.skipped,
                total: data.total,
                isRunning: false,
                isComplete: true,
              };

            case "job_failed":
              return {
                ...prev,
                phase: "failed",
                status: "failed",
                errors: [...prev.errors, typeof data.message === "string" ? data.message : "Download failed"],
                isRunning: false,
              };

            case "job_paused":
              return { ...prev, status: "paused" };

            case "job_resumed":
              return { ...prev, status: "downloading" };

            case "job_cancelled":
              return {
                ...prev,
                phase: "cancelled",
                status: "cancelled",
                isRunning: false,
              };

            case "retry_scheduled":
              return {
                ...prev,
                retryInfo: {
                  attempt: data.attempt,
                  delayMs: data.delay_ms,
                  startedAt: Date.now(),
                },
              };

            case "warning":
              return { ...prev, errors: [...prev.errors, data.message] };

            default:
              return prev;
          }
        });
      });

      unlistenRef.current = unlisten;
    };

    setup();

    return () => {
      mounted = false;
      unlistenRef.current?.();
    };
  }, []);

  const reset = useCallback(() => {
    setProgress(initialProgress);
  }, []);

  return { progress, reset };
}
