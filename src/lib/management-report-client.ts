import { desktopBridge } from "./desktop-bridge-registry";
import { isManagementDevice } from "./management-device";
import { ensureDesktopPosSession } from "./desktop-pos-session";
import type { PosBridge } from "@/core/local-db/local-db";

/** Dedicated read capability; generic management business writes stay disabled. */
export async function readManagementReport(options: Parameters<NonNullable<PosBridge["managementReport"]>>[0]) {
  if (!isManagementDevice() || typeof window === "undefined") return null;
  const bridge = desktopBridge("pos", window.pos ?? null);
  if (!bridge?.managementReport) return null;
  const authority = await ensureDesktopPosSession();
  if (!authority.ok) throw new Error(authority.error || "The desktop user could not be verified.");
  const result = await bridge.managementReport(options);
  if (!result.ok) {
    if (["EDATABASE_NOT_READY", "EMANAGEMENT_REPLICA_INCOMPLETE"].includes(result.code ?? "")) return null;
    throw Object.assign(new Error(result.error || "The management report could not be read."), { code: result.code });
  }
  if (result.complete !== true) return null;
  return result;
}
