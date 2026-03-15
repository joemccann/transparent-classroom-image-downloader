import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { listen } from "@tauri-apps/api/event";
import { useApp } from "../state/app";
import * as api from "../lib/tauri";
import type { ChildConfig } from "../types";

export function ChildrenSetup() {
  const { setScreen, setSettings, settings, schoolId } = useApp();
  const [children, setChildren] = useState<ChildConfig[]>(
    settings?.children?.length ? settings.children : []
  );
  const [error, setError] = useState<string | null>(null);

  // Listen for auto-detected children from DOM scraping
  useEffect(() => {
    const unlistenPromise = listen("tc-downloader-event", (event: any) => {
      const data = event.payload;

      // Batch children detected from nav DOM parsing
      if (data?.type === "children_detected" && Array.isArray(data.children)) {
        console.log("[CHILDREN] children_detected:", data.children);
        setChildren((prev) => {
          const existingIds = new Set(prev.map((c) => c.id));
          const newChildren = data.children
            .filter((c: any) => c.id && c.name && !existingIds.has(c.id))
            .map((c: any) => ({ id: c.id, name: c.name }));
          if (newChildren.length === 0) return prev;
          return [...prev, ...newChildren];
        });
      }

      // Single child detected from URL navigation (fallback)
      if (data?.type === "child_page_detected") {
        setChildren((prev) => {
          if (prev.some((c) => c.id === data.child_id)) return prev;
          return [...prev, { id: data.child_id, name: "" }];
        });
      }
    });
    return () => { unlistenPromise.then((fn) => fn()); };
  }, []);

  const updateChildName = useCallback((index: number, name: string) => {
    setChildren((prev) =>
      prev.map((c, i) => (i === index ? { ...c, name } : c))
    );
  }, []);

  const removeChild = (index: number) => {
    setChildren((prev) => prev.filter((_, i) => i !== index));
  };

  const handleNext = async () => {
    // Validate all children have names
    const unnamed = children.find((c) => !c.name.trim());
    if (unnamed) {
      setError("Please enter a name for all children.");
      return;
    }
    if (children.length === 0) {
      setError("Add at least one child before continuing.");
      return;
    }

    setSettings({
      school_id: schoolId || "2521",
      children: children.map((c) => ({ ...c, name: c.name.trim() })),
      output_dir: settings?.output_dir ?? "",
      concurrency: settings?.concurrency ?? 3,
      safe_mode: settings?.safe_mode ?? false,
    });

    try {
      await api.closeAuthWindow();
    } catch {
      // Window may already be closed
    }

    setScreen("destination");
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
          Your Children
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          We detected your children from Transparent Classroom.
          <br />
          <span className="text-zinc-500">
            Edit names if needed, then continue.
          </span>
        </p>
      </div>

      <div className="flex-1 space-y-3">
        {/* Children list — editable names */}
        {children.map((child, i) => (
          <div
            key={child.id}
            className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3"
          >
            <div className="flex-1">
              <input
                type="text"
                className="input-inset w-full"
                placeholder="Child's name"
                value={child.name}
                onChange={(e) => updateChildName(i, e.target.value)}
              />
              <p className="mt-1 text-xs text-zinc-500">ID: {child.id}</p>
            </div>
            <button
              onClick={() => removeChild(i)}
              className="rounded-lg px-2 py-1 text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-zinc-400"
            >
              &times;
            </button>
          </div>
        ))}

        {/* Empty state — waiting for detection */}
        {children.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-500 border-t-transparent" />
            </div>
            <p className="text-sm text-zinc-400">
              Detecting children from Transparent Classroom...
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              This happens automatically after login.
            </p>
          </div>
        )}

        {error && <p className="text-sm text-red-400">{error}</p>}
      </div>

      <div className="mt-8 flex justify-between">
        <button onClick={() => setScreen("auth")} className="btn-secondary">
          Back
        </button>
        <button
          onClick={handleNext}
          disabled={children.length === 0}
          className="btn-primary"
        >
          Next
        </button>
      </div>
    </motion.div>
  );
}
