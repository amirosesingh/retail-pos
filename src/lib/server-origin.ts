import { fetchWithDeadline } from "./fetch-deadline";
/**
 * Where this build should send app-server calls.
 *
 * The Android APK serves the whole app from a local origin inside the phone,
 * so a relative request to `/api/...` never reaches a real server — the local
 * static server answers with the app shell instead. The Windows till has the
 * same problem in reverse: its bundled local server used to answer privileged
 * calls itself, which meant keeping a privileged key on a shop counter.
 *
 * Both therefore send app-server calls to the hosted backend, whose address
 * is configured per device and applied at runtime by `backend-config.ts`.
 * There is deliberately NO build-time fallback: the same APK and installer
 * are sold to different customers, so an address baked in at build time would
 * point one customer's till at another customer's server. When the device has
 * nothing saved the address stays empty and the setup screen asks for it.
 * Web keeps using relative URLs.
 */
import { isWindowsShell, isMobileShell } from "@/platform-config/features";

function configured(): string {
  if (typeof window === "undefined") return "";
  const fromRuntime =
    (window as unknown as { __POS_SERVER_URL__?: string }).__POS_SERVER_URL__ ?? "";
  return fromRuntime.trim().replace(/\/+$/, "");
}

/** Absolute origin for app-server calls, or "" when relative URLs are right. */
export function serverOrigin(): string {
  if (typeof window === "undefined") return "";
  if (!isMobileShell() && !isWindowsShell()) return "";
  return configured();
}

/** True when a terminal app has no server to talk to for app-server endpoints. */
export function serverUnreachableOnDevice(): boolean {
  return (isMobileShell() || isWindowsShell()) && !configured();
}

/** Resolve an app path against the origin this shell should use. */
export function serverUrl(path: string): string {
  const origin = serverOrigin();
  if (!origin) return path;
  return `${origin}${path.startsWith("/") ? path : `/${path}`}`;
}

/** `fetch` that lands on a real server even inside the Android shell. */
export function posFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetchWithDeadline(serverUrl(path), init);
}