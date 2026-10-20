import { useEffect, useState } from "react";
import { isWindowsShell } from "@/platform-config/features";
import { readTerminalConfig, subscribeTerminalConfig } from "@/core/activation/terminal-tokens";
import { isManagementDevice } from "./management-device";
import { canStartLocally, observeLocalStartup, type LocalStartupState } from "./local-startup";

/** Reads Electron's validated SQL state, never the cloud or cached business data. */
export function useLocalStartupReady(): boolean {
  const [database, setDatabase] = useState<LocalStartupState | null>(null);
  const [config, setConfig] = useState(readTerminalConfig);
  useEffect(() => subscribeTerminalConfig(() => setConfig(readTerminalConfig())), []);
  useEffect(() => {
    if (!isWindowsShell()) return;
    const bridge = window.pos?.database;
    if (!bridge) return;
    return observeLocalStartup(bridge, setDatabase);
  }, []);
  return canStartLocally({ windows: isWindowsShell(), management: isManagementDevice(),
    tokenId: config?.tokenId, branchId: config?.locationId, database });
}
