import { invoke } from "@tauri-apps/api/core";
import type { AppSettings, ChildConfig } from "../types";

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
