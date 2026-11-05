import { createContext, useContext } from "react";
import type { SettingsContextValue } from "./SettingsFrame";

// Keep context identity separate from the hot-reloaded page component.
export const SettingsCtx = createContext<SettingsContextValue | null>(null);

export function useSettingsCtx(): SettingsContextValue {
  const ctx = useContext(SettingsCtx);
  if (!ctx) throw new Error("useSettingsCtx must be used inside <SettingsFrame>");
  return ctx;
}
