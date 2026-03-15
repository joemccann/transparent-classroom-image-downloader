import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useApp } from "../state/app";
import * as api from "../lib/tauri";

type JobRow = [string, string, string, number, number]; // id, status, created_at, completed, total

export function History() {
  const { setScreen } = useApp();
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .getJobHistory(20)
      .then(setJobs)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

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
            History
          </h1>
          <p className="mt-1 text-sm text-zinc-400">Previous download jobs.</p>
        </div>
        <button onClick={() => setScreen("scan_review")} className="btn-secondary text-xs">
          New Download
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-600 border-t-transparent" />
          </div>
        )}

        {!loading && jobs.length === 0 && (
          <div className="py-12 text-center text-sm text-zinc-500">
            No download history yet.
          </div>
        )}

        {!loading && jobs.length > 0 && (
          <div className="space-y-2">
            {jobs.map(([id, status, createdAt, completed, total]) => (
              <div
                key={id}
                className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3"
              >
                <div>
                  <p className="text-sm text-zinc-200">
                    {completed}/{total} photos
                  </p>
                  <p className="text-xs text-zinc-500">
                    {new Date(createdAt).toLocaleDateString()} &middot;{" "}
                    {new Date(createdAt).toLocaleTimeString()}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    status === "Completed"
                      ? "bg-emerald-950 text-emerald-300"
                      : status === "CompletedWithErrors"
                        ? "bg-amber-950 text-amber-300"
                        : status === "Failed"
                          ? "bg-red-950 text-red-300"
                          : "bg-zinc-800 text-zinc-400"
                  }`}
                >
                  {status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-8 flex justify-start">
        <button onClick={() => setScreen("scan_review")} className="btn-secondary">
          Back
        </button>
      </div>
    </motion.div>
  );
}
