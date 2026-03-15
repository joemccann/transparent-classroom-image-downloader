import { useState } from "react";
import { motion } from "framer-motion";
import { useApp } from "../state/app";
import * as api from "../lib/tauri";

export function Settings() {
  const { settings, setSettings, setScreen, setSessionValid } = useApp();
  const [concurrency, setConcurrency] = useState(settings?.concurrency ?? 3);
  const [safeMode, setSafeMode] = useState(settings?.safe_mode ?? false);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const updated = { ...settings, concurrency, safe_mode: safeMode };
      await api.saveSettings(
        updated.school_id,
        updated.children,
        updated.output_dir,
        updated.concurrency,
        updated.safe_mode
      );
      setSettings(updated);
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = async () => {
    try {
      await api.logout();
      setSessionValid(false);
      setScreen("auth");
    } catch {
      // ignore
    }
  };

  const handleReset = () => {
    setScreen("auth");
  };

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
          Settings
        </h1>
      </div>

      <div className="flex-1 space-y-6">
        {/* Concurrency */}
        <div>
          <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-zinc-500">
            Download Concurrency
          </label>
          <input
            type="number"
            min={1}
            max={10}
            className="input-inset w-24"
            value={concurrency}
            onChange={(e) => setConcurrency(parseInt(e.target.value) || 3)}
          />
          <p className="mt-1 text-xs text-zinc-600">
            Number of simultaneous downloads (1-10).
          </p>
        </div>

        {/* Safe mode */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSafeMode(!safeMode)}
            className={`relative h-6 w-11 rounded-full transition-colors ${
              safeMode ? "bg-indigo-600" : "bg-zinc-700"
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                safeMode ? "translate-x-[22px]" : "translate-x-0.5"
              }`}
            />
          </button>
          <div>
            <p className="text-sm text-zinc-200">Safe Mode</p>
            <p className="text-xs text-zinc-500">
              Adds delays between requests to avoid rate limiting.
            </p>
          </div>
        </div>

        <hr className="border-zinc-800" />

        {/* Session */}
        <div>
          <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-zinc-500">
            Session
          </label>
          <button onClick={handleLogout} className="btn-secondary text-xs">
            Logout / Clear Session
          </button>
        </div>

        {/* Reset */}
        <div>
          <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-zinc-500">
            Configuration
          </label>
          <button onClick={handleReset} className="btn-secondary text-xs">
            Reconfigure School & Children
          </button>
        </div>
      </div>

      <div className="mt-8 flex justify-between">
        <button onClick={() => setScreen("scan_review")} className="btn-secondary">
          Back
        </button>
        <button onClick={handleSave} disabled={saving} className="btn-primary">
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </motion.div>
  );
}
