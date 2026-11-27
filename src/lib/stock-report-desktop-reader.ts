import { effectiveDatabaseMode } from "@/core/local-db/db-mode";
import { localDb, type PosBridge } from "@/core/local-db/local-db";
import { isWindowsShell } from "@/platform-config/features";
import { desktopBridge } from "./desktop-bridge-registry";
import { isManagementDevice } from "./management-device";

const managementDesktop = () => isWindowsShell() && isManagementDevice();

export const usesLocalStockHistory = () => managementDesktop() || effectiveDatabaseMode() === "local";

/** Management's ordinary business bridge is disabled; these channels each enforce Main's report admission. */
export function stockHistoryDesktopReader(): Pick<PosBridge, "stockHistory" | "stockHistoryMovements" | "stockActivity" | "stockActivityBalances"> | null {
  return managementDesktop() ? desktopBridge("pos", window.pos ?? null) : localDb();
}
