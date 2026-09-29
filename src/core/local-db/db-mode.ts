/**
 * Where this till reads and writes: the online database, or the local one.
 *
 * Web, Android and iOS are online-only and send every change straight to the central
 * database. Windows is local-first and Electron's canonical connection state
 * selects the durable SQL Server path.
 */
import { isOnlineOnly } from "@/lib/live-mode";
import { hasFeature } from "@/platform-config/features";

export type DatabaseMode = "online" | "local";

const KEY = "pos.db.mode";
export const ONLINE_STARTUP_OVERRIDE = "pos.startup.online-only";
export const LOCAL_DATABASE_SETTINGS_REQUEST = "pos.local-database.settings-request";

type Listener = () => void;
const listeners = new Set<Listener>();

/** Set while an online-mode write could not reach the central database. */
let failingOver = false;

/** Set while this till is writing straight to the cloud because the local store failed. */
let cloudDirect = false;

const isBrowser = () => typeof window !== "undefined";

const notify = () => {
  for (const l of listeners) l();
};

export function subscribeDatabaseMode(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * A Windows till is local-first and reconciles in the background. Browser and
 * Android clients have no local business database and remain online-only.
 */
export const defaultDatabaseMode = (): DatabaseMode => (hasFeature("localDb") ? "local" : "online");

/** The mode fixed by the running platform. */
export function preferredDatabaseMode(): DatabaseMode {
  return defaultDatabaseMode();
}

export function setPreferredDatabaseMode(mode: DatabaseMode) {
  if (isBrowser()) window.localStorage.removeItem(KEY);
  if (mode === defaultDatabaseMode()) failingOver = false;
  notify();
}

export const databaseModeLocked = (): boolean => true;
export const isFailingOver = (): boolean => failingOver;
export const isCloudDirect = (): boolean => cloudDirect;

export function setCloudDirect(on: boolean) {
  if (cloudDirect === on) return;
  cloudDirect = on;
  notify();
}

export function unreachableMessage(): string {
  return isOnlineOnly()
    ? "Central database unavailable. Please check the network connection or contact an administrator."
    : "Local transaction storage unavailable. The payment was not accepted. " +
        "Open Settings → Database & Cloud Connection and check the local SQL Server connection.";
}

function localFailureMessage(cause?: unknown): string {
  const error = cause as { message?: string; code?: string } | undefined;
  const detail = String(error?.message ?? "");
  const code = String(error?.code ?? "").toUpperCase();

  if (code === "EBRIDGE_UNAVAILABLE" || /Electron database bridge unavailable/i.test(detail)) {
    return "Electron database bridge unavailable. Restart the Retail desktop app.";
  }
  if (code.includes("SQLSERVER_SCHEMA") || /SQL Server.*schema|schema.*SQL Server|no such table|no such column/i.test(detail)) {
    return "Local SQL Server schema is not ready. Repair the selected database from Settings before taking payments.";
  }
  if (code.includes("SQLSERVER_WRITE") || /SQL Server.*write|write.*SQL Server|readonly database|disk.*full/i.test(detail)) {
    return "Local SQL Server write failed. The payment was not accepted. Check database health, then retry.";
  }
  return unreachableMessage();
}

export class AllTargetsFailed extends Error {
  readonly context: string;
  constructor(context: string, cause?: unknown) {
    super(`${context}: ${localFailureMessage(cause)}`);
    this.name = "AllTargetsFailed";
    this.context = context;
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

export function noteConnectionLost() {
  if (failingOver) return;
  failingOver = true;
  notify();
}

export function noteConnectionRestored() {
  if (!failingOver) return;
  failingOver = false;
  notify();
}

const online = () => !isBrowser() || window.navigator.onLine;

export function effectiveDatabaseMode(): DatabaseMode {
  const startupOnline = isBrowser() && window.sessionStorage.getItem(ONLINE_STARTUP_OVERRIDE) === "1";
  return isOnlineOnly() || startupOnline ? "online" : "local";
}

export function databaseModeLabel(): string {
  if (cloudDirect) return "Cloud direct";
  return effectiveDatabaseMode() === "local" ? "Local first" : "Online";
}

export function isConnectionError(error: unknown): boolean {
  const message = ((error as { message?: string })?.message ?? String(error)).toLowerCase();
  return (
    !online() ||
    /failed to fetch|network|load failed|timeout|timed out|econn|fetch failed|offline/.test(message)
  );
}

export function startDatabaseModeWatch() {
  if (!isBrowser()) return () => {};
  const back = () => noteConnectionRestored();
  const gone = () => noteConnectionLost();
  window.addEventListener("online", back);
  window.addEventListener("offline", gone);
  return () => {
    window.removeEventListener("online", back);
    window.removeEventListener("offline", gone);
  };
}
