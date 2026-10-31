import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { DesktopAdoptionUnavailableError } from "./desktop-adoption-availability.server";

/**
 * Short-lived signed device token for terminal compatibility paths. Every
 * staff member also has a backend Auth account; this token is minted only
 * after the canonical app_users PIN hash has been checked server-side.
 */
const TTL_MS = 12 * 60 * 60 * 1000;

function secret(): Buffer {
  const raw = process.env["SETTINGS_ENCRYPTION_KEY"];
  if (!raw) throw new Error("SETTINGS_ENCRYPTION_KEY is not configured");
  return createHash("sha256").update(raw, "utf8").digest();
}

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");

export function signCashierSession(payload: { id: string; username: string; storeId: string|null; sessionToken: string }): string {
  const body = b64(JSON.stringify({ ...payload, exp: Date.now() + TTL_MS }));
  const sig = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export async function verifyCashierSession(
  token: string,
  options: { strictAvailability?: boolean } = {},
): Promise<{ id: string; username: string; storeId: string|null; sessionToken: string; terminalId?: string|null } | null> {
  const [body, sig] = (token || "").split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", secret()).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as {
      id: string;
      username: string;
      storeId: string|null;
      exp: number;
      sessionToken?: string;
    };
    if (!parsed.exp || parsed.exp < Date.now() || !(typeof parsed.storeId==="string" || parsed.storeId===null)) return null;
    // Unbound legacy proofs must be renewed with a PIN. Omitting a raw token
    // must not bypass the login's remote revocation or idle expiry.
    if (!parsed.sessionToken) return null;
    const { touchSession } = await import("./session-guard.server");
    let checked: Awaited<ReturnType<typeof touchSession>>;
    try { checked = await touchSession(parsed.sessionToken); }
    catch (error) {
      if (options.strictAvailability) throw new DesktopAdoptionUnavailableError();
      throw error;
    }
    if (options.strictAvailability && !checked.ok && checked.reason === "unavailable")
      throw new DesktopAdoptionUnavailableError();
    if (!checked.ok || checked.session.kind !== "cashier" ||
        checked.session.staff_user_id !== parsed.username ||
        (checked.session.branch_id||null) !== (parsed.storeId||null)) return null;
    return { id: parsed.id, username: parsed.username, storeId: parsed.storeId, sessionToken: parsed.sessionToken,
      ...(checked.session.terminal_id ? {terminalId:checked.session.terminal_id}: {}) };
  } catch (error) {
    if (options.strictAvailability && error instanceof DesktopAdoptionUnavailableError) throw error;
    return null;
  }
}
