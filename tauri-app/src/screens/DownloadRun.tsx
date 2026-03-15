import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useApp } from "../state/app";
import { useDownloadProgress, type DownloadPhase } from "../hooks/useDownloadProgress";
import * as api from "../lib/tauri";
import { extractErrorMessage } from "../lib/tauri";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatEta(seconds: number): string {
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.ceil(seconds % 60);
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}

type StepStatus = "pending" | "active" | "done";

function stepStatus(phase: DownloadPhase, step: 1 | 2): StepStatus {
  if (step === 1) {
    if (phase === "scanning") return "active";
    if (phase === "downloading" || phase === "complete") return "done";
    return "pending";
  }
  // step 2
  if (phase === "downloading") return "active";
  if (phase === "complete") return "done";
  return "pending";
}

function StepIndicator({ step, label, status }: { step: number; label: string; status: StepStatus }) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors duration-300 ${
          status === "done"
            ? "bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/40"
            : status === "active"
              ? "bg-white/10 text-white ring-1 ring-white/30"
              : "bg-zinc-800/60 text-zinc-600 ring-1 ring-zinc-700/40"
        }`}
      >
        {status === "done" ? (
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          step
        )}
      </div>
      <span
        className={`text-sm font-medium transition-colors duration-300 ${
          status === "done"
            ? "text-zinc-500"
            : status === "active"
              ? "text-zinc-100"
              : "text-zinc-600"
        }`}
      >
        {label}
      </span>
    </div>
  );
}

export function DownloadRun() {
  const { setScreen } = useApp();
  const { progress, reset } = useDownloadProgress();
  const [jobError, setJobError] = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    api.startDownload().catch((e: unknown) => {
      setJobError(extractErrorMessage(e));
    });
  }, []);

  useEffect(() => {
    if (progress.isComplete) {
      const timer = setTimeout(() => setScreen("complete"), 1500);
      return () => clearTimeout(timer);
    }
  }, [progress.isComplete, setScreen]);

  const { phase } = progress;
  const s1 = stepStatus(phase, 1);
  const s2 = stepStatus(phase, 2);

  // ETA calculation
  const processedCount = progress.completed + progress.failed + progress.skipped;
  let etaStr: string | null = null;
  if (phase === "downloading" && progress.downloadStartedAt && processedCount > 0 && progress.total > 0) {
    const elapsed = (Date.now() - progress.downloadStartedAt) / 1000;
    const avgPerItem = elapsed / processedCount;
    const remaining = progress.total - processedCount;
    if (remaining > 0) {
      etaStr = formatEta(avgPerItem * remaining);
    }
  }

  const pct = progress.total > 0 ? Math.round((processedCount / progress.total) * 100) : 0;
  const isPaused = progress.status === "paused";

  return (
    <motion.div
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -40 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="flex h-full flex-col"
    >
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tighter text-zinc-50">
          {phase === "complete" ? "Download Complete" : "Syncing Photos"}
        </h1>
      </div>

      <div className="flex-1 space-y-5">
        {/* Steps */}
        <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/50 p-4">
          <div className="flex items-center gap-2">
            <StepIndicator step={1} label="Scan pages" status={s1} />
            <div className={`mx-1 h-px flex-1 transition-colors duration-500 ${
              s1 === "done" ? "bg-emerald-500/30" : "bg-zinc-800"
            }`} />
            <StepIndicator step={2} label="Download photos" status={s2} />
          </div>

          {/* Step detail — shown below the step indicators */}
          <div className="mt-3 min-h-[2.5rem] pl-10">
            {phase === "idle" && (
              <p className="text-sm text-zinc-500">Starting...</p>
            )}

            {phase === "scanning" && (
              <div className="space-y-2">
                {progress.scanProgress.size > 0 ? (
                  Array.from(progress.scanProgress.entries()).map(([child, sp]) => {
                    const scanPct = sp.totalPages > 0 ? Math.round((sp.page / sp.totalPages) * 100) : 0;
                    return (
                      <div key={child} className="space-y-1">
                        <div className="flex items-baseline justify-between text-sm">
                          <span className="text-zinc-300">{child}</span>
                          <span className="text-xs text-zinc-500">
                            {sp.page}/{sp.totalPages} pages &middot; {sp.photosFound} photos
                          </span>
                        </div>
                        <div className="h-1 overflow-hidden rounded-full bg-zinc-800">
                          <motion.div
                            className="h-full rounded-full bg-zinc-500"
                            initial={{ width: 0 }}
                            animate={{ width: `${scanPct}%` }}
                            transition={{ duration: 0.2, ease: "easeOut" }}
                          />
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-sm text-zinc-500">Connecting to Transparent Classroom...</p>
                )}
                {progress.scanTotalFound > 0 && progress.scanProgress.size > 1 && (
                  <p className="mt-1 text-xs text-zinc-600">
                    {progress.scanTotalFound} total across all children
                  </p>
                )}
              </div>
            )}

            {phase === "downloading" && (
              <div className="space-y-3">
                {/* Progress bar */}
                <div>
                  <div className="mb-1.5 flex items-baseline justify-between">
                    <span className="text-sm text-zinc-300">
                      {processedCount} / {progress.total} photos
                    </span>
                    <span className="flex items-baseline gap-2 text-xs text-zinc-500">
                      {formatBytes(progress.bytesDownloaded)}
                      {etaStr && (
                        <>
                          <span className="text-zinc-700">&middot;</span>
                          <span>~{etaStr} remaining</span>
                        </>
                      )}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
                    <motion.div
                      className="h-full rounded-full bg-white"
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.3, ease: "easeOut" }}
                    />
                  </div>
                </div>

                {/* Current file */}
                {progress.currentFile && (
                  <p className="truncate text-xs text-zinc-500">
                    {progress.currentChild && <span className="text-zinc-400">{progress.currentChild}</span>}
                    {progress.currentChild && " — "}
                    {progress.currentFile}
                  </p>
                )}
              </div>
            )}

            {phase === "complete" && (
              <p className="text-sm text-emerald-400">
                {progress.completed} photos downloaded
                {progress.skipped > 0 && `, ${progress.skipped} skipped`}
                {progress.failed > 0 && `, ${progress.failed} failed`}
              </p>
            )}

            {(phase === "failed" || phase === "cancelled") && (
              <p className="text-sm text-red-400">
                {phase === "cancelled" ? "Download was cancelled." : "Download failed."}
              </p>
            )}
          </div>
        </div>

        {/* Stats row — visible once download phase starts */}
        {progress.total > 0 && phase === "downloading" && (
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 py-3 text-center">
              <p className="text-xl font-bold text-zinc-50">{progress.completed}</p>
              <p className="mt-0.5 text-[11px] uppercase tracking-wider text-zinc-600">Downloaded</p>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 py-3 text-center">
              <p className="text-xl font-bold text-zinc-50">{progress.skipped}</p>
              <p className="mt-0.5 text-[11px] uppercase tracking-wider text-zinc-600">Skipped</p>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 py-3 text-center">
              <p className={`text-xl font-bold ${progress.failed > 0 ? "text-red-400" : "text-zinc-50"}`}>
                {progress.failed}
              </p>
              <p className="mt-0.5 text-[11px] uppercase tracking-wider text-zinc-600">Failed</p>
            </div>
          </div>
        )}

        {/* Reconnecting banner */}
        {progress.retryInfo && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-2.5 rounded-lg border border-amber-900/50 bg-amber-950/30 px-3 py-2.5"
          >
            <svg className="h-4 w-4 shrink-0 animate-spin text-amber-400" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <div>
              <p className="text-xs font-medium text-amber-300">
                Reconnecting... (attempt {progress.retryInfo.attempt}/5)
              </p>
              <p className="text-[11px] text-amber-500/70">
                Network issue detected. Retrying automatically.
              </p>
            </div>
          </motion.div>
        )}

        {/* Errors */}
        {(jobError || progress.errors.length > 0) && (
          <div className="max-h-28 overflow-y-auto rounded-lg border border-red-900/50 bg-red-950/30 p-3">
            <p className="text-[11px] font-medium uppercase tracking-wider text-red-500">Errors</p>
            {jobError && (
              <p className="mt-1.5 text-xs text-red-300">{jobError}</p>
            )}
            {progress.errors.map((err, i) => (
              <p key={i} className="mt-1 text-xs text-red-300">{err}</p>
            ))}
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="mt-6 flex justify-between">
        <button
          onClick={() => {
            api.cancelDownload();
            reset();
            setScreen("destination");
          }}
          className="btn-secondary"
          disabled={progress.isComplete}
        >
          Cancel
        </button>

        {progress.isRunning && !progress.isComplete && (
          <button
            onClick={() => (isPaused ? api.resumeDownload() : api.pauseDownload())}
            className="btn-secondary"
          >
            {isPaused ? "Resume" : "Pause"}
          </button>
        )}
      </div>
    </motion.div>
  );
}
