import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useApp } from "../state/app";
import { useDownloadProgress } from "../hooks/useDownloadProgress";
import { StatusBadge } from "../components/common/StatusBadge";
import * as api from "../lib/tauri";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function DownloadRun() {
  const { setScreen } = useApp();
  const { progress, reset } = useDownloadProgress();
  const [started, setStarted] = useState(false);
  const [jobError, setJobError] = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    api.startDownload().catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      setJobError(msg);
    });
    setStarted(true);
  }, []);

  // Navigate to complete screen when done
  useEffect(() => {
    if (progress.isComplete) {
      const timer = setTimeout(() => setScreen("complete"), 1500);
      return () => clearTimeout(timer);
    }
  }, [progress.isComplete, setScreen]);

  const pct =
    progress.total > 0
      ? Math.round((progress.completed / progress.total) * 100)
      : 0;

  const isPaused = progress.status === "paused";

  return (
    <motion.div
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -40 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="flex h-full flex-col"
    >
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tighter text-zinc-50">
            Downloading
          </h1>
          <p className="mt-1 text-sm text-zinc-400">{progress.phase}</p>
        </div>
        <StatusBadge
          status={
            progress.isComplete
              ? "success"
              : progress.status === "failed"
                ? "error"
                : progress.isRunning
                  ? "running"
                  : "idle"
          }
          label={
            progress.isComplete
              ? `${progress.completed} photos synced`
              : progress.isRunning
                ? `${pct}%`
                : progress.phase
          }
        />
      </div>

      <div className="flex-1 space-y-6">
        {/* Progress bar */}
        <div>
          <div className="mb-2 flex justify-between text-xs text-zinc-500">
            <span>
              {progress.completed} / {progress.total} photos
            </span>
            <span>{formatBytes(progress.bytesDownloaded)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
            <motion.div
              className="h-full rounded-full bg-white"
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.3, ease: "easeOut" }}
            />
          </div>
        </div>

        {/* Current activity */}
        {progress.currentFile && (
          <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3">
            <p className="text-xs font-medium text-zinc-500">Current</p>
            <p className="mt-0.5 truncate text-sm text-zinc-300">
              {progress.currentChild} &mdash; {progress.currentFile}
            </p>
          </div>
        )}

        {/* Scan progress */}
        {progress.scanProgress.size > 0 && (
          <div className="space-y-2">
            {Array.from(progress.scanProgress.entries()).map(([child, sp]) => (
              <div
                key={child}
                className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-2 text-sm"
              >
                <span className="text-zinc-300">{child}</span>
                <span className="text-zinc-500">
                  Page {sp.page}/{sp.totalPages} &middot; {sp.photosFound} found
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Counters */}
        {progress.total > 0 && (
          <div className="grid grid-cols-3 gap-3">
            <div className="card text-center">
              <p className="text-2xl font-bold text-zinc-50">
                {progress.completed}
              </p>
              <p className="mt-1 text-xs text-zinc-500">Downloaded</p>
            </div>
            <div className="card text-center">
              <p className="text-2xl font-bold text-zinc-50">
                {progress.skipped}
              </p>
              <p className="mt-1 text-xs text-zinc-500">Skipped</p>
            </div>
            <div className="card text-center">
              <p className="text-2xl font-bold text-red-400">
                {progress.failed}
              </p>
              <p className="mt-1 text-xs text-zinc-500">Failed</p>
            </div>
          </div>
        )}

        {/* Errors */}
        {(jobError || progress.errors.length > 0) && (
          <div className="max-h-32 overflow-y-auto rounded-lg border border-red-900 bg-red-950/50 p-3">
            <p className="text-xs font-medium text-red-400">Errors</p>
            {jobError && (
              <p className="mt-1 text-xs text-red-300">{jobError}</p>
            )}
            {progress.errors.map((err, i) => (
              <p key={i} className="mt-1 text-xs text-red-300">
                {err}
              </p>
            ))}
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="mt-8 flex justify-between">
        <button
          onClick={() => {
            api.cancelDownload();
            reset();
            setScreen("scan_review");
          }}
          className="btn-secondary"
          disabled={progress.isComplete}
        >
          Cancel
        </button>

        <div className="flex gap-2">
          {progress.isRunning && !progress.isComplete && (
            <button
              onClick={() => (isPaused ? api.resumeDownload() : api.pauseDownload())}
              className="btn-secondary"
            >
              {isPaused ? "Resume" : "Pause"}
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}
