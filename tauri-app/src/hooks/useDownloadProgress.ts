import { useCallback, useEffect, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AppEvent, JobStatus } from "../types";

export interface DownloadProgress {
  phase: string;
  status: JobStatus | null;
  jobId: string | null;
  currentChild: string | null;
  currentFile: string | null;
  completed: number;
  failed: number;
  skipped: number;
  total: number;
  bytesDownloaded: number;
  scanProgress: Map<string, { page: number; totalPages: number; photosFound: number }>;
  errors: string[];
  isRunning: boolean;
  isComplete: boolean;
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
  errors: [],
  isRunning: false,
  isComplete: false,
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
              return { ...prev, phase: "Checking session...", isRunning: true };

            case "session_valid":
              return { ...prev, phase: "Session valid" };

            case "session_expired":
              return { ...prev, phase: "Session expired", isRunning: false };

            case "auth_started":
              return { ...prev, phase: "Authenticating..." };

            case "auth_completed":
              return { ...prev, phase: "Authenticated" };

            case "auth_failed":
              return {
                ...prev,
                phase: "Auth failed",
                errors: [...prev.errors, data.message],
                isRunning: false,
              };

            case "scan_started":
              return {
                ...prev,
                phase: `Scanning ${data.child_name}...`,
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
              return { ...prev, scanProgress: newMap };
            }

            case "scan_completed":
              return {
                ...prev,
                phase: `Found ${data.new_photos} new photos for ${data.child_name}`,
              };

            case "download_started":
              return {
                ...prev,
                phase: "Downloading...",
                jobId: data.job_id,
                total: data.total_items,
                status: "downloading",
                isRunning: true,
              };

            case "download_item_started":
              return {
                ...prev,
                currentChild: data.child_name,
                currentFile: data.filename,
              };

            case "download_item_completed":
              return { ...prev, completed: prev.completed + 1 };

            case "download_item_failed":
              return {
                ...prev,
                failed: prev.failed + 1,
                errors: data.will_retry
                  ? prev.errors
                  : [...prev.errors, `Failed: ${data.filename}`],
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
                phase: "Complete",
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
                phase: "Failed",
                status: "failed",
                errors: [...prev.errors, data.message],
                isRunning: false,
              };

            case "job_paused":
              return { ...prev, phase: "Paused", status: "paused" };

            case "job_resumed":
              return { ...prev, phase: "Downloading...", status: "downloading" };

            case "job_cancelled":
              return {
                ...prev,
                phase: "Cancelled",
                status: "cancelled",
                isRunning: false,
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
