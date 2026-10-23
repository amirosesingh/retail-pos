import { getRequest, getRequestIP } from "@tanstack/react-start/server";

import { throttleFail, throttleStatus } from "./pin-throttle.server";

function callerIp(request?: Request): string | null {
  let scoped: Request | undefined = request;
  let transportIp: string | undefined;
  try {
    scoped ??= getRequest();
    transportIp = getRequestIP();
  } catch {
    // Direct server calls in tests have no request scope. The SQL account
    // lockout remains authoritative even when there is no address to count.
  }
  const value = (transportIp || scoped?.headers.get("cf-connecting-ip") || "").trim();
  return /^[0-9a-f:.]{3,64}$/i.test(value) ? value.toLowerCase() : null;
}

/** One address bucket shared by every public PIN entry point. */
export async function beginPinRequest(request?: Request): Promise<{
  key: string | null;
  locked: boolean;
}> {
  const ip = callerIp(request);
  if (!ip) return { key: null, locked: false };
  const key = `cashier-ip:${ip}`;
  return { key, locked: (await throttleStatus(key)).locked };
}

export async function finishPinRequest(key: string | null, valid: boolean): Promise<void> {
  // A valid PIN on another account must not erase this address's failed guesses.
  if (key && !valid) await throttleFail(key);
}
