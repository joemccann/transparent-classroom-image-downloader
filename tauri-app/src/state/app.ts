import { createContext, useContext } from "react";
import type { AppSettings, Screen } from "../types";

export interface AppContextValue {
  screen: Screen;
  setScreen: (s: Screen) => void;
  settings: AppSettings | null;
  setSettings: (s: AppSettings | null) => void;
  sessionValid: boolean;
  setSessionValid: (v: boolean) => void;
  isFirstRun: boolean;
  schoolId: string | null;
  setSchoolId: (id: string | null) => void;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppContext.Provider");
  return ctx;
}
