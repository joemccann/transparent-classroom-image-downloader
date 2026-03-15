import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { listen } from "@tauri-apps/api/event";
import { useApp } from "../state/app";
import * as api from "../lib/tauri";

type AuthState = "idle" | "waiting" | "success" | "failed";

export function AuthConnect() {
  const { setScreen, setSessionValid, setSchoolId, schoolId } = useApp();
  const [authState, setAuthState] = useState<AuthState>("idle");
  const [error, setError] = useState<string | null>(null);

  // Listen for auth events from the Rust backend
  useEffect(() => {
    const unlistenPromise = listen("tc-downloader-event", (event: any) => {
      const data = event.payload;
      console.log("[AUTH] event received:", data);
      if (!data || !data.type) return;

      switch (data.type) {
        case "auth_completed":
          console.log("[AUTH] auth_completed event");
          setAuthState("success");
          setSessionValid(true);
          break;
        case "auth_failed":
          console.log("[AUTH] auth_failed event:", data.message);
          setAuthState("failed");
          setError(data.message || "Authentication failed.");
          break;
        case "school_detected":
          console.log("[AUTH] school_detected:", data.school_id);
          setSchoolId(data.school_id);
          break;
      }
    });

    return () => {
      unlistenPromise.then((fn) => fn());
    };
  }, [setSessionValid, setSchoolId]);

  // Auto-advance when auth is done and school detected
  useEffect(() => {
    if (authState === "success" && schoolId) {
      const timer = setTimeout(() => setScreen("children_setup"), 1500);
      return () => clearTimeout(timer);
    }
  }, [authState, schoolId, setScreen]);

  const startAuth = useCallback(async () => {
    console.log("[AUTH] startAuth called");
    setError(null);
    setAuthState("waiting");

    try {
      console.log("[AUTH] calling openAuthWindow...");
      await api.openAuthWindow();
      console.log("[AUTH] openAuthWindow resolved OK");
    } catch (e: unknown) {
      console.error("[AUTH] openAuthWindow FAILED:", e);
      setAuthState("failed");
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Failed to open login window: ${msg}`);
    }
  }, []);

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
          Sign In
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Sign in to Transparent Classroom. The URL bar in the login window
          shows the current page address.
        </p>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center gap-6">
        {authState === "idle" && (
          <div className="text-center">
            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900">
              <svg className="h-8 w-8 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
              </svg>
            </div>
            <p className="mb-4 text-sm text-zinc-400">
              A browser window will open for you to sign in.
            </p>
            <button onClick={startAuth} className="btn-accent">
              Open Login Window
            </button>
          </div>
        )}

        {authState === "waiting" && (
          <div className="text-center">
            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl border border-indigo-900 bg-indigo-950">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
            </div>
            <p className="text-sm text-zinc-300">
              Waiting for login...
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              Complete sign-in in the browser window.
            </p>
            <button onClick={startAuth} className="mt-4 btn-secondary text-xs">
              Re-open Window
            </button>
          </div>
        )}

        {authState === "success" && (
          <div className="text-center">
            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl border border-emerald-900 bg-emerald-950">
              <svg className="h-10 w-10 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </div>
            <p className="text-sm font-medium text-emerald-300">
              Authenticated{schoolId ? ` — School: ${schoolId}` : ""}
            </p>
            {!schoolId && (
              <p className="mt-1 text-xs text-zinc-500">
                Detecting school ID from URL...
              </p>
            )}
          </div>
        )}

        {authState === "failed" && (
          <div className="text-center">
            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl border border-red-900 bg-red-950">
              <svg className="h-10 w-10 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            {error && <p className="mb-4 max-w-sm text-sm text-red-400">{error}</p>}
            <button onClick={startAuth} className="btn-secondary">
              Retry Login
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
}
