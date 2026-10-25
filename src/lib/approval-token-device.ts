import { readTerminalConfig } from "@/core/activation/terminal-tokens";
import { isWindowsShell } from "@/platform-config/features";

/** Branch PCs receive approvals; only explicitly registered management PCs issue tokens. */
export function canIssueApprovalTokenOnDevice(): boolean {
  const config = readTerminalConfig();
  if (!config?.tokenId) return false;
  return !isWindowsShell() || (config.deviceUse === "management" && !config.locationId);
}
