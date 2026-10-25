/** Authenticate an email/password staff account by its unique login alias.
 * The email lookup and password check both stay on the hosted server; the
 * public caller receives tokens only after Auth verifies the password.
 */
import { createClient } from "@supabase/supabase-js";
import { serviceRest } from "@/core/api/pos-relay.server";
import { failureFromAuthError } from "@/lib/login-failure";
import { supabaseConfig } from "@/lib/external-supabase-config";

type StaffIdentity = {
  user_id: string;
  login_username: string | null;
  email: string;
  auth_user_id: string | null;
  is_active: boolean;
};

export type UsernameLoginResult =
  | { ok: true; accessToken: string; refreshToken: string; projectUrl: string }
  | { ok: false; code: "invalid_credentials" | "central_unavailable" };

export async function staffUsernameLogin(
  username: string,
  password: string,
): Promise<UsernameLoginResult> {
  const alias = username.trim().toLowerCase();
  if (!/^[a-z0-9._-]{2,40}$/.test(alias) || !password)
    return { ok: false, code: "invalid_credentials" };

  const encoded = encodeURIComponent(alias);
  const response = await serviceRest(
    `app_users?or=(user_id.eq.${encoded},login_username.eq.${encoded})&select=user_id,login_username,email,auth_user_id,is_active&limit=2`,
  );
  if (!response.ok) return { ok: false, code: "central_unavailable" };
  const rows = (await response.json()) as StaffIdentity[];
  const account = rows.length === 1 ? rows[0] : null;
  if (!account?.is_active || !account.auth_user_id || !account.email)
    return { ok: false, code: "invalid_credentials" };

  const { url, key } = supabaseConfig();
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email: account.email,
    password,
  });
  if (error) {
    const failure = failureFromAuthError(error);
    return { ok: false, code: failure === "invalid-credentials" || failure === "account-inactive"
      ? "invalid_credentials" : "central_unavailable" };
  }
  if (!data.session || data.user?.id.toLowerCase() !== account.auth_user_id.toLowerCase())
    return { ok: false, code: "invalid_credentials" };
  return {
    ok: true,
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
    projectUrl: url,
  };
}
