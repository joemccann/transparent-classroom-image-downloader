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
  const [pendingChildId, setPendingChildId] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Listen for child page detection events
  useEffect(() => {
    const unlistenPromise = listen("tc-downloader-event", (event: any) => {
      const data = event.payload;
      if (data?.type === "child_page_detected") {
        // Only set pending if not already added
        const alreadyAdded = children.some((c) => c.id === data.child_id);
        if (!alreadyAdded) {
          setPendingChildId(data.child_id);
          setNameInput("");
        }
      }
    });
    return () => { unlistenPromise.then((fn) => fn()); };
  }, [children]);

  const addChild = useCallback(() => {
    if (!pendingChildId || !nameInput.trim()) return;
    setChildren((prev) => [...prev, { id: pendingChildId, name: nameInput.trim() }]);
    setPendingChildId(null);
    setNameInput("");
  }, [pendingChildId, nameInput]);

  const removeChild = (index: number) => {
    setChildren((prev) => prev.filter((_, i) => i !== index));
  };

  const handleNext = async () => {
    if (children.length === 0) {
      setError("Add at least one child before continuing.");
      return;
    }

    // Save settings and close auth window
    setSettings({
      school_id: schoolId || "2521",
      children,
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
          Add Children
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Click on each child in the Transparent Classroom window.
          <br />
          <span className="text-zinc-500">
            We'll detect their ID automatically — just enter their name.
          </span>
        </p>
      </div>

      <div className="flex-1 space-y-4">
        {/* Added children */}
        {children.map((child, i) => (
          <div
            key={child.id}
            className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3"
          >
            <div>
              <p className="text-sm font-medium text-zinc-200">{child.name}</p>
              <p className="text-xs text-zinc-500">ID: {child.id}</p>
            </div>
            <button
              onClick={() => removeChild(i)}
              className="rounded-lg px-2 py-1 text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-zinc-400"
            >
              &times;
            </button>
          </div>
        ))}

        {/* Pending child — name input */}
        {pendingChildId && (
          <div className="rounded-lg border border-indigo-900 bg-indigo-950/30 px-4 py-3">
            <p className="mb-2 text-xs font-medium text-indigo-400">
              Child detected — ID: {pendingChildId}
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                className="input-inset flex-1"
                placeholder="Enter child's name"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addChild()}
                autoFocus
              />
              <button
                onClick={addChild}
                disabled={!nameInput.trim()}
                className="btn-accent"
              >
                Add
              </button>
            </div>
          </div>
        )}

        {/* Empty state — no children added yet */}
        {children.length === 0 && !pendingChildId && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900">
              <svg className="h-7 w-7 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
              </svg>
            </div>
            <p className="text-sm text-zinc-400">
              Navigate to a child's page in the TC window.
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              Click on a child's name in the sidebar to detect their ID.
            </p>
          </div>
        )}

        {/* Add another child prompt — shown after at least one child is added */}
        {children.length > 0 && !pendingChildId && (
          <div className="flex flex-col items-center rounded-lg border border-dashed border-zinc-700 bg-zinc-900/30 py-6 text-center">
            <p className="text-sm text-zinc-400">
              Click another child in the TC window to add them, or continue.
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
