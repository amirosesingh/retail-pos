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
  signal?: AbortSignal,
): Promise<UsernameLoginResult> {
  const alias = username.trim().toLowerCase();
  if (!/^[a-z0-9._-]{2,40}$/.test(alias) || !password)
    return { ok: false, code: "invalid_credentials" };

  // One budget covers lookup, Auth headers and Auth response-body reading.
  // A client that stops waiting must not leave unbounded password work behind.
  const budget = AbortSignal.timeout(20_000);
  const deadline = signal ? AbortSignal.any([signal, budget]) : budget;
  try {
    const encoded = encodeURIComponent(alias);
    const response = await serviceRest(
      `app_users?or=(user_id.eq.${encoded},login_username.eq.${encoded})&select=user_id,login_username,email,auth_user_id,is_active&limit=2`,
      { signal: deadline },
    );
    if (!response.ok) return { ok: false, code: "central_unavailable" };
    const rows = (await response.json()) as StaffIdentity[];
    if (!Array.isArray(rows)) return { ok: false, code: "central_unavailable" };
    const account = rows.length === 1 ? rows[0] : null;
    if (!account || account.is_active === false)
      return { ok: false, code: "invalid_credentials" };
    if (account.is_active !== true || typeof account.auth_user_id !== "string" || !account.auth_user_id ||
        typeof account.email !== "string" || !account.email)
      return { ok: false, code: "central_unavailable" };

    const { url, key } = supabaseConfig();
    const client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: (input, init) => {
        const caller = init?.signal ?? (input instanceof Request ? input.signal : undefined);
        return fetch(input, { ...init, signal: caller ? AbortSignal.any([caller, deadline]) : deadline });
      } },
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
    if (!data.session?.access_token || !data.session.refresh_token || typeof data.user?.id !== "string" ||
        data.user.id.toLowerCase() !== account.auth_user_id.toLowerCase())
      return { ok: false, code: "central_unavailable" };
    return {
      ok: true,
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      projectUrl: url,
    };
  } catch {
    return { ok: false, code: "central_unavailable" };
  }
}
