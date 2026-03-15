import { useState } from "react";
import { motion } from "framer-motion";
import { open } from "@tauri-apps/plugin-dialog";
import { useApp } from "../state/app";
import * as api from "../lib/tauri";

export function DestinationSetup() {
  const { settings, setSettings, setScreen } = useApp();
  const [outputDir, setOutputDir] = useState(settings?.output_dir ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickFolder = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Select Download Folder",
    });
    if (selected && typeof selected === "string") {
      setOutputDir(selected);
    }
  };

  const handleNext = async () => {
    setError(null);
    if (!outputDir.trim()) {
      setError("Please select a download folder");
      return;
    }
    if (!settings) return;

    const updated = { ...settings, output_dir: outputDir.trim() };
    setSaving(true);

    try {
      await api.saveSettings(
        updated.school_id,
        updated.children,
        updated.output_dir,
        updated.concurrency,
        updated.safe_mode
      );
      setSettings(updated);
      setScreen("download");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Failed to save settings: ${msg}`);
    } finally {
      setSaving(false);
    }
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
          Download Folder
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Choose where photos will be saved. A subfolder is created per child.
        </p>
      </div>

      <div className="flex-1 space-y-6">
        <div>
          <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-zinc-500">
            Destination
          </label>

          <div className="flex gap-3">
            <input
              type="text"
              className="input-inset flex-1"
              placeholder="~/Downloads/Photos"
              value={outputDir}
              readOnly
            />
            <button onClick={pickFolder} className="btn-secondary whitespace-nowrap">
              Browse...
            </button>
          </div>

          {outputDir && (
            <p className="mt-2 text-xs text-zinc-500">
              Photos will be saved to:
              {settings?.children.map((c) => (
                <span key={c.id} className="ml-1 rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-300">
                  {outputDir}/{c.name}/
                </span>
              ))}
            </p>
          )}
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}
      </div>

      <div className="mt-8 flex justify-between">
        <button onClick={() => setScreen("children_setup")} className="btn-secondary">
          Back
        </button>
        <button onClick={handleNext} disabled={saving} className="btn-primary">
          {saving ? "Saving..." : "Next"}
        </button>
      </div>
    </motion.div>
  );
}
