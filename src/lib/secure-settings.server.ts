import { supabaseConfig } from "./external-supabase-config";
import { decryptSetting, encryptSetting, maskSetting } from "./settings-crypto.server";

export type SecureSettingKey =
  | "whatsapp_token"
  | "whatsapp_phone_number_id"
  | "bank_account_number"
  | "bank_account_name"
  | "bank_name"
  | "update_feed_token"
  | "integration_api_key"
  | "local_db_password"
  | "twilio_account_sid"
  | "twilio_auth_token"
  | "twilio_from"
  | "sendgrid_api_key"
  | "email_from";

export const SECURE_SETTING_KEYS: SecureSettingKey[] = [
  "whatsapp_token",
  "whatsapp_phone_number_id",
  "bank_account_number",
  "bank_account_name",
  "bank_name",
  "update_feed_token",
  "integration_api_key",
  "local_db_password",
  "twilio_account_sid",
  "twilio_auth_token",
  "twilio_from",
  "sendgrid_api_key",
  "email_from",
];

/**
 * Verifies the caller against the POS Supabase project and returns their role.
 * The token is validated server-side and the role comes only from the staff
 * record in the database — the self-declared `user_metadata.role` in the JWT is
 * never trusted. Callers without a staff record are rejected (fail closed).
 */
export async function verifyPosStaff(accessToken: string): Promise<{
  userId: string;
  role: string;
  isAdmin: boolean;
  storeId: string;
  permissions: Record<string, boolean>;
}> {
  const headers = {
    apikey: supabaseConfig().key,
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };

  const userRes = await fetch(`${supabaseConfig().url}/auth/v1/user`, { headers });
  if (!userRes.ok) throw new Error("Not signed in");
  const user = (await userRes.json()) as { id: string };

  const rpc = await fetch(`${supabaseConfig().url}/rest/v1/rpc/current_app_user`, {
    method: "POST",
    headers,
    body: "{}",
  });
  if (!rpc.ok) throw new Error("Could not verify your staff record");

  const rows = (await rpc.json()) as unknown;
  const row = (Array.isArray(rows) ? rows[0] : rows) as
    | {
        role?: string;
        is_active?: boolean;
        store_id?: string | null;
        permissions?: Record<string, unknown> | null;
      }
    | null;
  const role = row?.role;
  if (!role) throw new Error("No staff record for this account");
  // Fail closed: only an explicitly activated staff record counts. Self-service
  // signups land as inactive and must be approved by an admin first.
  if (row?.is_active !== true) {
    throw new Error("This account is awaiting administrator approval");
  }

  return {
    userId: user.id,
    role,
    isAdmin: role === "admin" || role === "manager",
    storeId: String(row?.store_id ?? ""),
    permissions: Object.fromEntries(
      Object.entries(row?.permissions ?? {}).map(([key, value]) => [key, value === true]),
    ),
  };
}

/* ------------------------- encrypted value store ------------------------- */

/**
 * Encrypted values live on the POS database with everything else, reached with
 * the POS service key. The key and the plaintext never leave the server.
 */
async function posRest(path: string, init: RequestInit & { prefer?: string } = {}) {
  const { serviceRest } = await import("@/core/api/pos-relay.server");
  return serviceRest(path, init);
}

async function failed(res: Response, action: string): Promise<never> {
  const text = (await res.text()).slice(0, 300);
  throw new Error(`${action} failed on the central database: ${text}`);
}

export async function writeSecureSetting(
  key: SecureSettingKey,
  plaintext: string,
  updatedBy: string,
) {
  const res = await posRest("secure_settings?on_conflict=key", {
    method: "POST",
    body: JSON.stringify([
      {
        key,
        ciphertext: encryptSetting(plaintext),
        hint: maskSetting(plaintext),
        updated_by: updatedBy,
        updated_at: new Date().toISOString(),
      },
    ]),
    prefer: "return=minimal,resolution=merge-duplicates",
  });
  if (!res.ok) await failed(res, "Saving the secure value");
}

export async function removeSecureSetting(key: SecureSettingKey) {
  const res = await posRest(`secure_settings?key=eq.${encodeURIComponent(key)}`, {
    method: "DELETE",
    prefer: "return=minimal",
  });
  if (!res.ok) await failed(res, "Removing the secure value");
}

/** Masked view for the UI — plaintext never leaves the server. */
export async function listSecureSettingHints() {
  const res = await posRest("secure_settings?select=key,hint,updated_at,updated_by");
  if (!res.ok) await failed(res, "Reading the secure values");
  return (await res.json()) as {
    key: string;
    hint: string | null;
    updated_at: string;
    updated_by: string | null;
  }[];
}

/** Server-only plaintext read, used by the handlers that call the provider. */
export async function readSecureSetting(key: SecureSettingKey): Promise<string | null> {
  const res = await posRest(
    `secure_settings?select=ciphertext&key=eq.${encodeURIComponent(key)}&limit=1`,
  );
  if (!res.ok) return null;
  const rows = (await res.json()) as { ciphertext: string }[];
  const row = rows[0];
  if (!row) return null;
  try {
    return decryptSetting(row.ciphertext);
  } catch {
    return null;
  }
}
