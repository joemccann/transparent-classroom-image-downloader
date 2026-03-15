import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

import { AppContext } from "./state/app";
import type { AppSettings, Screen } from "./types";
import * as api from "./lib/tauri";

import { StepIndicator } from "./components/common/StepIndicator";
import { Onboarding } from "./screens/Onboarding";
import { DestinationSetup } from "./screens/DestinationSetup";
import { AuthConnect } from "./screens/AuthConnect";
import { ScanReview } from "./screens/ScanReview";
import { DownloadRun } from "./screens/DownloadRun";
import { Complete } from "./screens/Complete";
import { History } from "./screens/History";
import { Settings } from "./screens/Settings";

const SETUP_STEPS = ["Credentials", "Folder", "Auth", "Download"];

function getStepIndex(screen: Screen): number {
  switch (screen) {
    case "onboarding":
      return 0;
    case "destination":
      return 1;
    case "auth":
      return 2;
    case "scan_review":
    case "download":
    case "complete":
      return 3;
    default:
      return -1;
  }
}

export default function App() {
  const [screen, setScreen] = useState<Screen>("onboarding");
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [sessionValid, setSessionValid] = useState(false);
  const [isFirstRun, setIsFirstRun] = useState(true);
  const [loading, setLoading] = useState(true);

  // Load saved settings on mount
  useEffect(() => {
    api
      .loadSettings()
      .then((saved) => {
        if (saved && saved.school_id && saved.children.length > 0 && saved.output_dir) {
          setSettings(saved);
          setIsFirstRun(false);
          // Returning user — go to scan review (dashboard)
          setScreen("scan_review");

          // Check session in background
          api.checkSession().then((valid) => {
            setSessionValid(valid);
            if (!valid) setScreen("auth");
          }).catch(() => {});
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const stepIndex = getStepIndex(screen);
  const showSteps = stepIndex >= 0 && screen !== "complete";
  const showNav = ["scan_review", "history", "settings", "complete"].includes(screen);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <AppContext.Provider
      value={{
        screen,
        setScreen,
        settings,
        setSettings,
        sessionValid,
        setSessionValid,
        isFirstRun,
      }}
    >
      <div className="flex h-screen flex-col bg-zinc-950">
        {/* Header / Navigation */}
        <header className="glass-panel mx-4 mt-4 flex items-center justify-between rounded-xl px-5 py-3">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold tracking-tight text-zinc-200">
              TC Downloader
            </h2>
          </div>

          {showSteps && <StepIndicator steps={SETUP_STEPS} current={stepIndex} />}

          {showNav && (
            <div className="flex gap-1">
              <NavButton
                label="Download"
                active={["scan_review", "download", "complete"].includes(screen)}
                onClick={() => setScreen("scan_review")}
              />
              <NavButton
                label="History"
                active={screen === "history"}
                onClick={() => setScreen("history")}
              />
              <NavButton
                label="Settings"
                active={screen === "settings"}
                onClick={() => setScreen("settings")}
              />
            </div>
          )}

          {!showSteps && !showNav && <div />}
        </header>

        {/* Main content */}
        <main className="flex-1 overflow-hidden px-4 pb-4 pt-4">
          <div className="mx-auto h-full max-w-lg">
            <AnimatePresence mode="wait">
              {screen === "onboarding" && <Onboarding key="onboarding" />}
              {screen === "destination" && <DestinationSetup key="destination" />}
              {screen === "auth" && <AuthConnect key="auth" />}
              {screen === "scan_review" && <ScanReview key="scan_review" />}
              {screen === "download" && <DownloadRun key="download" />}
              {screen === "complete" && <Complete key="complete" />}
              {screen === "history" && <History key="history" />}
              {screen === "settings" && <Settings key="settings" />}
            </AnimatePresence>
          </div>
        </main>
      </div>
    </AppContext.Provider>
  );
}

function NavButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
        active
          ? "bg-white/10 text-zinc-100"
          : "text-zinc-500 hover:bg-white/5 hover:text-zinc-300"
      }`}
    >
      {label}
    </button>
  );
}
