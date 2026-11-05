/**
 * Last verified register rules for this device, kept across restarts.
 *
 * A phone or till that loses its connection must keep working with the rules
 * it last genuinely received, not silently fall back to the strict built-in
 * safety set. Only the rule values and their identity stamp are stored — never
 * a PIN, token, signing key or database key — in the same encrypted device
 * store the rest of the app uses.
 *
 * The entry is branch-aware: a terminal moved to another branch discards it
 * rather than carrying the old branch's policy across.
 */
import { getDeviceSecret, setDeviceSecret, clearDeviceSecret } from "./device-secrets";
import { normalizeRules, type PosRules } from "./pos-rules";
import { isWindowsShell } from "@/platform-config/features";

const SLOT = "pos-rules-last-good";

export type CachedRules = {
  terminalId: string;
  branchId: string;
  revision: string;
  syncedAt: number;
  rules: PosRules;
  /** Verified capability belongs to this exact terminal/branch/backend/project. */
  cacheScope?: string;
  shiftSharingAvailable?: boolean;
  /** Read-only upgrade fallback; never a proof of the configured connection. */
  legacyScope?: boolean;
  /**
   * A change made on this till that the central database has not confirmed
   * yet. It stays in force locally until the confirmation comes back.
   */
  pending?: boolean;
  rowVersion?: number;
  updatedAt?: string | null;
  updatedBy?: string | null;
};

type Stored = Omit<CachedRules, "rules"> & { rules: unknown };

/** No credentials/query strings; preserve backend path prefixes in the identity. */
export function rulesCacheScope(terminalId: string, branchId: string, backend: string, project: string): string {
  if (!terminalId || !branchId || !backend || !project) return "";
  const origin = (raw: string) => {
    const url = new URL(raw);
    if (url.username || url.password || url.search || url.hash ||
        !["http:", "https:"].includes(url.protocol) ||
        url.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Invalid rules cache origin");
    return url.origin + url.pathname.replace(/\/+$/, "");
  };
  try { return JSON.stringify([terminalId, branchId, origin(backend), origin(project)]); }
  catch { return ""; }
}

/** The stored set, but only when it belongs to this terminal and branch. */
export async function readCachedRules(
  terminalId: string,
  branchId: string,
  cacheScope = "",
): Promise<CachedRules | null> {
  let stored: Stored | null;
  if (typeof window !== "undefined" && isWindowsShell()) {
    const bridge = (window as unknown as {
      pos?: { getSetting?: (key: string) => Promise<{ value?: string | null }> };
    }).pos;
    const value = await bridge?.getSetting?.(SLOT).catch(() => null);
    stored = (() => {
      try {
        return value?.value ? (JSON.parse(value.value) as Stored) : null;
      } catch {
        return null;
      }
    })();
  } else {
    stored = await getDeviceSecret<Stored>(SLOT).catch(() => null);
  }
  if (!stored || typeof stored !== "object") return null;
  if ((stored.branchId ?? "") !== branchId) return null;
  if (stored.terminalId && terminalId && stored.terminalId !== terminalId) return null;
  // Preserve old branch+terminal-matched operating values during an offline
  // upgrade, without claiming connection verification or allowing new edits.
  const legacyScope = !stored.cacheScope;
  if (legacyScope && (!terminalId || !stored.terminalId || stored.terminalId !== terminalId)) return null;
  if (cacheScope && stored.cacheScope && stored.cacheScope !== cacheScope) return null;
  if (!cacheScope && stored.cacheScope) return null;
  return {
    terminalId: stored.terminalId ?? "",
    branchId: stored.branchId ?? "",
    revision: stored.revision ?? "",
    syncedAt: Number(stored.syncedAt) || 0,
    rules: normalizeRules(stored.rules),
    cacheScope: stored.cacheScope || undefined,
    legacyScope,
    shiftSharingAvailable: Boolean(cacheScope && stored.cacheScope === cacheScope && stored.shiftSharingAvailable === true),
    pending: stored.pending === true,
    rowVersion: Math.max(0, Number(stored.rowVersion) || 0),
    updatedAt: typeof stored.updatedAt === "string" ? stored.updatedAt : null,
    updatedBy: typeof stored.updatedBy === "string" ? stored.updatedBy : null,
  };
}

/** Replace the stored set in one step; a matching revision is left alone. */
export async function writeCachedRules(entry: CachedRules): Promise<void> {
  if (typeof window !== "undefined" && isWindowsShell()) {
    const bridge = (window as unknown as {
      pos?: { setSetting?: (key: string, value: string | null) => Promise<unknown> };
    }).pos;
    await bridge?.setSetting?.(SLOT, JSON.stringify(entry));
    return;
  }
  await setDeviceSecret(SLOT, entry).catch(() => undefined);
}

export function clearCachedRules(): void {
  if (typeof window !== "undefined" && isWindowsShell()) {
    const bridge = (window as unknown as {
      pos?: { setSetting?: (key: string, value: string | null) => Promise<unknown> };
    }).pos;
    void bridge?.setSetting?.(SLOT, null);
    return;
  }
  clearDeviceSecret(SLOT);
}
