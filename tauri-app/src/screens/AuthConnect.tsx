import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useApp } from "../state/app";
import * as api from "../lib/tauri";

type AuthState = "idle" | "waiting" | "validating" | "success" | "failed";

export function AuthConnect() {
  const { setScreen, setSessionValid } = useApp();
  const [authState, setAuthState] = useState<AuthState>("idle");
  const [error, setError] = useState<string | null>(null);
  const pollerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const authWindowRef = useRef<WebviewWindow | null>(null);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (pollerRef.current) clearInterval(pollerRef.current);
      authWindowRef.current?.close();
    };
  }, []);

  const startAuth = useCallback(async () => {
    setAuthState("idle");
    setError(null);

    // First check if session is already valid
    try {
      const valid = await api.checkSession();
      if (valid) {
        setAuthState("success");
        setSessionValid(true);
        return;
      }
    } catch {
      // Proceed to login
    }

    setAuthState("waiting");

    try {
      const loginUrl = await api.getLoginUrl();

      // Open a new Tauri webview window for login
      const authWindow = new WebviewWindow("auth-login", {
        url: loginUrl,
        title: "Sign in to Transparent Classroom",
        width: 800,
        height: 700,
        center: true,
        resizable: true,
      });

      authWindowRef.current = authWindow;

      // Poll the auth window's URL to detect successful login
      pollerRef.current = setInterval(async () => {
        try {
          // Execute JS in the auth window to check URL and get cookies
          // We detect auth success when the URL no longer contains /sign_in
          const result = await authWindow.emit("check-auth");

          // Alternative: use tauri's webview eval to get the URL
          // For now, we'll use a JS injection approach
        } catch {
          // Window may have been closed
        }
      }, 2000);

      // Listen for the window being closed
      authWindow.onCloseRequested(async () => {
        if (pollerRef.current) clearInterval(pollerRef.current);

        // Try to validate the session after the window closes
        setAuthState("validating");
        try {
          const valid = await api.checkSession();
          if (valid) {
            setAuthState("success");
            setSessionValid(true);
          } else {
            setAuthState("failed");
            setError("Login was not completed. Please try again.");
          }
        } catch (e: unknown) {
          setAuthState("failed");
          const msg = e instanceof Error ? e.message : String(e);
          setError(`Session validation failed: ${msg}`);
        }
      });
    } catch (e: unknown) {
      setAuthState("failed");
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Failed to open login window: ${msg}`);
    }
  }, [setSessionValid]);

  const handleNext = () => {
    setScreen("scan_review");
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
          Sign In
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Authenticate with Transparent Classroom to access your photos.
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
              A browser window will open. Sign in with your TC account.
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
              Complete sign-in in the browser window, then close it.
            </p>
          </div>
        )}

        {authState === "validating" && (
          <div className="text-center">
            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-500 border-t-transparent" />
            </div>
            <p className="text-sm text-zinc-300">Validating session...</p>
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
              Authenticated successfully
            </p>
          </div>
        )}

        {authState === "failed" && (
          <div className="text-center">
            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl border border-red-900 bg-red-950">
              <svg className="h-10 w-10 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            {error && <p className="mb-4 text-sm text-red-400">{error}</p>}
            <button onClick={startAuth} className="btn-secondary">
              Retry Login
            </button>
          </div>
        )}
      </div>

      <div className="mt-8 flex justify-between">
        <button onClick={() => setScreen("destination")} className="btn-secondary">
          Back
        </button>
        <button
          onClick={handleNext}
          disabled={authState !== "success"}
          className="btn-primary"
        >
          Next
        </button>
      </div>
    </motion.div>
  );
}
