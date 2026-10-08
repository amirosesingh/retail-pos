import { readTerminalConfig } from "@/core/activation/terminal-tokens";
import { isWindowsShell, isMobileShell } from "@/platform-config/features";
import { readBusinessValue, writeBusinessValue } from "./business-storage";

const DEVICE_KEY = "pos.document.device";
let sessionDevice: string | null = null;
export function documentPlatform(): "WIN" | "AND" | "WEB" {
  return isWindowsShell() ? "WIN" : isMobileShell() ? "AND" : "WEB";
}
/** Activation UUIDs identify devices, not staff authentication secrets. */
export function documentDevice(): string {
  const token = readTerminalConfig()?.tokenId;
  if (token && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token))
    return token.replaceAll("-", "").toUpperCase();
  const saved = readBusinessValue(DEVICE_KEY);
  if (saved && /^[0-9A-F]{32}$/.test(saved)) return saved;
  // Electron keeps business state in SQL. An unactivated session gets a new
  // namespace on restart, so losing a browser counter cannot repeat a number.
  sessionDevice ??= crypto.randomUUID().replaceAll("-", "").toUpperCase();
  writeBusinessValue(DEVICE_KEY, sessionDevice);
  return sessionDevice;
}
export function documentOrigin(branch: string): string {
  const code = branch.toUpperCase().replace(/[^A-Z0-9]/g, "") || "BR";
  return `${code}-${documentPlatform()}-${documentDevice()}`;
}
