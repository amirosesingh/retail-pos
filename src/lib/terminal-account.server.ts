/**
 * Hidden per-terminal cloud account.
 *
 * A till that is signed in with a username + PIN has no account on the central
 * database, so every direct write is refused. Once a terminal is activated it
 * is given its own machine account (never shown to staff) with the staff role,
 * so ordinary writes succeed under the normal row rules. The relay stays as a
 * fallback for tills that cannot hold a session.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { runtimeEnvValue, supabaseConfig } from "./external-supabase-config";
import { serviceRest, serviceKey } from "@/core/api/pos-relay.server";

export type TerminalAccount = { email: string; password: string };

const emailFor = (tokenId: string) => `terminal.${tokenId}@pos.local`;

/** Deterministic password so the same terminal always recovers its account. */
function passwordFor(tokenId: string): string {
  // Cloudflare injects secrets per request; unlike Node they are not always
  // copied into process.env. Reading both paths fixes provisioning in the
  // hosted worker without ever sending the secret to the terminal.
  const secret =
    runtimeEnvValue("SETTINGS_ENCRYPTION_KEY") ?? process.env["SETTINGS_ENCRYPTION_KEY"];
  if (!secret) throw new Error("SETTINGS_ENCRYPTION_KEY is not configured");
  return `T${createHmac("sha256", secret).update(`terminal:${tokenId}`).digest("base64url").slice(0, 40)}`;
}

async function adminFetch(path: string, init: RequestInit = {}) {
  const key = serviceKey();
  const headers: Record<string, string> = {
    apikey: key,
    "Content-Type": "application/json",
    ...((init.headers as Record<string, string>) ?? {}),
  };
  if (!key.startsWith("sb_")) headers["Authorization"] = `Bearer ${key}`;
  return fetch(`${supabaseConfig().url}/auth/v1/${path}`, { ...init, headers });
}

/**
 * Create (or repair) the machine account for an activated terminal and return
 * the credentials the till should keep encrypted on the device.
 */
export async function ensureTerminalAccount(
  tokenId: string,
  proofHash: string,
): Promise<TerminalAccount> {
  const tokenRes = await serviceRest(
    `terminal_tokens?id=eq.${encodeURIComponent(tokenId)}&select=id,status,location_id,location_name,revoked_at,claimed_at,claim_proof,claimed_proof_hash`,
  );
  if (!tokenRes.ok) throw new Error("Could not reach the central database");
  const token = ((await tokenRes.json()) as {
    status?: string;
    location_id?: string | null;
    location_name?: string | null;
    revoked_at?: string | null;
    claimed_at?: string | null;
    claim_proof?: string | null;
    claimed_proof_hash?: string | null;
  }[])[0];
  if (!token || token.revoked_at || (token.status !== "active" && token.status !== "used")) {
    throw new Error("This terminal is not activated");
  }
  if (!token.claimed_at) throw new Error("This terminal has not completed activation");
  // A user-agent is descriptive and spoofable. Credentials are released only
  // when the caller proves possession of the per-device key used at claim.
  const expectedProof = token.claim_proof ?? token.claimed_proof_hash;
  const supplied = Buffer.from(proofHash);
  const expected = Buffer.from(expectedProof ?? "");
  if (
    !expected.length ||
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  ) {
    throw new Error("This activation belongs to another device");
  }

  const email = emailFor(tokenId);
  const password = passwordFor(tokenId);

  const created = await adminFetch("admin/users", {
    method: "POST",
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        terminal_token: tokenId,
        full_name: `Terminal ${token.location_name ?? tokenId.slice(0, 8)}`,
        store_id: token.location_id ?? null,
      },
    }),
  });

  let userId: string | null = null;
  if (created.ok) {
    userId = ((await created.json()) as { id?: string }).id ?? null;
  } else {
    // Already exists: look it up and reset the password to the derived value.
    const list = await adminFetch(`admin/users?page=1&per_page=1&email=${encodeURIComponent(email)}`);
    if (list.ok) {
      const body = (await list.json()) as { users?: { id: string; email?: string }[] };
      userId = body.users?.find((u) => u.email?.toLowerCase() === email)?.id ?? null;
    }
    if (!userId) throw new Error("Could not prepare this terminal's account");
    const repaired = await adminFetch(`admin/users/${userId}`, {
      method: "PUT",
      body: JSON.stringify({ password, email_confirm: true }),
    });
    if (!repaired.ok) throw new Error("Could not repair this terminal's account");
  }

  if (userId) {
    const profile = await serviceRest("app_users?on_conflict=user_id", {
      method: "POST",
      prefer: "return=minimal,resolution=merge-duplicates",
      body: JSON.stringify([
        {
          user_id: `terminal-${tokenId.slice(0, 8)}`,
          full_name: `Terminal ${token.location_name ?? tokenId.slice(0, 8)}`,
          email,
          role: "staff",
          store_id: token.location_id ?? null,
          auth_user_id: userId,
          is_active: true,
        },
      ]),
    });
    if (!profile.ok) throw new Error("Could not authorize this terminal account");
    const role = await serviceRest("user_roles?on_conflict=user_id,role", {
      method: "POST",
      prefer: "return=minimal,resolution=merge-duplicates",
      body: JSON.stringify([{ user_id: userId, role: "staff" }]),
    });
    if (!role.ok) throw new Error("Could not assign this terminal account role");
  }

  return { email, password };
}
