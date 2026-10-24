import { createHash, createHmac, timingSafeEqual } from "node:crypto";

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

export function signCashierSession(payload: { id: string; username: string; storeId: string; sessionToken: string }): string {
  const body = b64(JSON.stringify({ ...payload, exp: Date.now() + TTL_MS }));
  const sig = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export async function verifyCashierSession(
  token: string,
): Promise<{ id: string; username: string; storeId: string; sessionToken: string } | null> {
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
      storeId: string;
      exp: number;
      sessionToken?: string;
    };
    if (!parsed.exp || parsed.exp < Date.now() || !parsed.storeId) return null;
    // Unbound legacy proofs must be renewed with a PIN. Omitting a raw token
    // must not bypass the login's remote revocation or idle expiry.
    if (!parsed.sessionToken) return null;
    const { touchSession } = await import("./session-guard.server");
    const checked = await touchSession(parsed.sessionToken);
    if (!checked.ok || checked.session.kind !== "cashier" ||
        checked.session.staff_user_id !== parsed.username ||
        checked.session.branch_id !== parsed.storeId) return null;
    return { id: parsed.id, username: parsed.username, storeId: parsed.storeId, sessionToken: parsed.sessionToken };
  } catch {
    return null;
  }
}
