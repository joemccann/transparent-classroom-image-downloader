import { invoke } from "@tauri-apps/api/core";
import type { AppSettings, ChildConfig } from "../types";

/** Extract a human-readable message from a Tauri command error. */
export function extractErrorMessage(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  // Tauri serializes AppError as { kind, message }
  if (e && typeof e === "object") {
    const obj = e as Record<string, unknown>;
    if (typeof obj.message === "string") return obj.message;
    if (typeof obj.kind === "string") return friendlyError(obj.kind, obj.message);
  }
  return "An unexpected error occurred";
}

/** Map Rust error kinds to user-friendly messages. */
function friendlyError(kind: string, _detail?: unknown): string {
  switch (kind) {
    case "network_error":
      return "Network connection lost. Please check your internet and try again.";
    case "session_expired":
      return "Your session has expired. Please log in again.";
    case "auth_required":
      return "Authentication required. Please log in first.";
    case "auth_failed":
      return "Login failed. Please check your credentials.";
    case "rate_limited":
      return "Too many requests. Waiting before retrying...";
    case "config_error":
      return "Settings are incomplete. Please go back and check your configuration.";
    case "storage_error":
      return "Failed to save data locally. Check disk space and permissions.";
    case "io_error":
      return "File system error. Check that the download folder exists and is writable.";
    case "scrape_error":
    case "markup_drift":
      return "The Transparent Classroom page layout has changed. Please update the app.";
    default:
      return typeof _detail === "string" ? _detail : "Something went wrong. Please try again.";
  }
}

// ── Settings ──

export async function saveSettings(
  schoolId: string,
  children: ChildConfig[],
  outputDir: string,
  concurrency?: number,
  safeMode?: boolean
): Promise<void> {
  return invoke("save_settings", {
    schoolId,
    children,
    outputDir,
    concurrency,
    safeMode,
  });
}

export async function loadSettings(): Promise<AppSettings | null> {
  return invoke("load_settings");
}

export async function getDownloadStats(): Promise<[string, number][]> {
  return invoke("get_download_stats");
}

// ── Auth ──

export async function checkSession(): Promise<boolean> {
  return invoke("check_session");
}

export async function openAuthWindow(): Promise<void> {
  return invoke("open_auth_window");
}

export async function completeAuth(cookies: string): Promise<boolean> {
  return invoke("complete_auth", { cookies });
}

export async function logout(): Promise<void> {
  return invoke("logout");
}

export async function closeAuthWindow(): Promise<void> {
  return invoke("close_auth_window");
}

export async function getLoginUrl(): Promise<string> {
  return invoke("get_login_url");
}

// ── Jobs ──

export async function startDownload(): Promise<string> {
  return invoke("start_download");
}

export async function pauseDownload(): Promise<void> {
  return invoke("pause_download");
}

export async function resumeDownload(): Promise<void> {
  return invoke("resume_download");
}

export async function cancelDownload(): Promise<void> {
  return invoke("cancel_download");
}

export async function getJobHistory(
  limit?: number
): Promise<[string, string, string, number, number][]> {
  return invoke("get_job_history", { limit });
}

export async function openOutputFolder(): Promise<void> {
  return invoke("open_output_folder");
}
