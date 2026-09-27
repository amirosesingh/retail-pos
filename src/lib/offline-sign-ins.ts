/**
 * Sign-ins that happened while the till was cut off.
 *
 * An offline sign-in is still a fact head office needs, so it is queued as an
 * audit row through the ordinary sync outbox. The row id is derived from the
 * terminal, the person and the minute, so the same sign-in replayed by a retry
 * is an upsert onto the same row rather than a duplicate.
 */
import { commitOps } from "@/core/api/pos-db";
import { readTerminalConfig } from "@/core/activation/terminal-tokens";

/** Stable UUID-shaped id from a stable string. No dependency, no randomness. */
async function deterministicId(seed: string): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(seed)),
  ).slice(0, 16);
  // RFC 4122 variant/version bits so Postgres accepts it as a uuid.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function queueOfflineSignIn(input: {
  username: string;
  fullName: string;
  storeId: string | null;
}): Promise<void> {
  if (typeof window === "undefined") return;
  const at = new Date();
  const minute = at.toISOString().slice(0, 16);
  let terminalId = "";
  try {
    terminalId = readTerminalConfig()?.tokenId ?? "";
  } catch {
    /* no till registered */
  }
  const id = await deterministicId(`offline-signin|${terminalId}|${input.username}|${minute}`);
  await commitOps("cashier-login", [{
    kind: "upsert",
    table: "audit_logs",
    onConflict: "id",
    rows: [
      {
        id,
        user_name: input.fullName || input.username,
        action_category: "auth",
        action_name: "offline_sign_in",
        target_module: "terminal",
        details: {
          username: input.username,
          store_id: input.storeId,
          terminal_id: terminalId || null,
          signed_in_at: at.toISOString(),
          source: "local-database",
        },
        store_id: input.storeId,
        created_at: at.toISOString(),
      },
    ],
  }]);
}
