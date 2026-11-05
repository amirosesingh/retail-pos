import { throttleFail, throttleStatus } from "./pin-throttle.server";

async function callerIp(request?: Request, transport?: { readonly trustedWorkerIp: string | null }): Promise<string | null> {
  // Only the Worker entry can supply this private context. A missing address
  // must not fall back to headers on an explicitly trusted Worker request.
  if (transport) {
    const value = (transport.trustedWorkerIp ?? "").trim();
    return /^[0-9a-f:.]{3,64}$/i.test(value) ? value.toLowerCase() : null;
  }
  let scoped: Request | undefined = request;
  let transportIp: string | undefined;
  try {
    // Framework callers retain their transport-IP precedence without making
    // the Worker login path initialize the framework request context.
    const { getRequest, getRequestIP } = await import("@tanstack/react-start/server");
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
export async function beginPinRequest(request?: Request, signal?: AbortSignal, transport?: { readonly trustedWorkerIp: string | null }): Promise<{
  key: string | null;
  locked: boolean;
}> {
  const ip = await callerIp(request, transport);
  if (!ip) return { key: null, locked: false };
  const key = `cashier-ip:${ip}`;
  return { key, locked: (await (signal ? throttleStatus(key,signal) : throttleStatus(key))).locked };
}

export async function finishPinRequest(key: string | null, valid: boolean, signal?: AbortSignal): Promise<void> {
  // A valid PIN on another account must not erase this address's failed guesses.
  // The address bucket tolerates normal shared-shop mistakes; each account
  // still has its own five-attempt lockout.
  if (key && !valid) await (signal ? throttleFail(key,20,signal) : throttleFail(key,20));
}
