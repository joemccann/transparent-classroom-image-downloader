import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useApp } from "../state/app";
import * as api from "../lib/tauri";

export function ScanReview() {
  const { settings, setScreen } = useApp();
  const [stats, setStats] = useState<[string, number][]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .getDownloadStats()
      .then(setStats)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const totalPrevious = stats.reduce((sum, [, count]) => sum + count, 0);

  return (
    <motion.div
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -40 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="flex h-full flex-col"
    >
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tighter text-zinc-50">
          Review
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Confirm your settings before starting the download.
        </p>
      </div>

      <div className="flex-1 space-y-4">
        {/* Settings summary */}
        <div className="card space-y-3">
          <div className="flex justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">
              School
            </span>
            <span className="text-sm text-zinc-200">{settings?.school_id}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">
              Children
            </span>
            <span className="text-sm text-zinc-200">
              {settings?.children.map((c) => c.name).join(", ")}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">
              Destination
            </span>
            <span className="max-w-[300px] truncate text-sm text-zinc-200">
              {settings?.output_dir}
            </span>
          </div>
        </div>

        {/* Previous downloads */}
        {!loading && totalPrevious > 0 && (
          <div className="card">
            <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-zinc-500">
              Previous Downloads
            </h3>
            <div className="space-y-2">
              {stats.map(([name, count]) => (
                <div key={name} className="flex justify-between text-sm">
                  <span className="text-zinc-300">{name}</span>
                  <span className="text-zinc-400">{count} photos</span>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-zinc-500">
              Previously downloaded photos will be skipped automatically.
            </p>
          </div>
        )}

        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
          <p className="text-sm text-zinc-400">
            The downloader will scan all photo pages for each child, identify new
            photos, and download them to your chosen folder organized by year.
          </p>
        </div>
      </div>

      <div className="mt-8 flex justify-between">
        <button onClick={() => setScreen("auth")} className="btn-secondary">
          Back
        </button>
        <button onClick={() => setScreen("download")} className="btn-primary">
          Start Download
        </button>
      </div>
    </motion.div>
  );
}
