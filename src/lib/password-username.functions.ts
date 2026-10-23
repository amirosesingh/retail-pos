import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseConfig } from "./external-supabase-config";
import { isExternalEmail } from "./internal-domains";
import { passwordUsernameLookup } from "./password-username";

const requestSchema = z.object({
  username: z.string().regex(/^[a-z0-9._-]{2,40}$/),
  password: z.string().min(1).max(1024),
  projectUrl: z.string().url().max(500),
}).strict();
const accountSchema = z.object({
  email: z.string(),
  auth_user_id: z.string().uuid().nullable(),
  is_active: z.boolean(),
});
const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  user: z.object({ id: z.string().uuid() }).passthrough(),
});

/** Resolve an email-account alias without exposing its email to anonymous callers. */
export const signInWithPasswordUsername = createServerFn({ method: "POST" })
  .validator((input: unknown) => requestSchema.parse(input))
  .handler(async ({ data }) => {
    const config = supabaseConfig();
    // A terminal's operator-managed project must match the server holding its
    // account directory; never authenticate against an unrelated project.
    if (data.projectUrl.replace(/\/$/, "") !== config.url.replace(/\/$/, ""))
      return { ok: false as const, code: "configuration-invalid" as const };
    try {
      const { serviceRest } = await import("@/core/api/pos-relay.server");
      const response = await serviceRest(passwordUsernameLookup(data.username), { signal: AbortSignal.timeout(8000) });
      if (!response.ok) return { ok: false as const, code: "cloud-unreachable" as const };
      const accounts = z.array(accountSchema).max(2).parse(await response.json());
      // Neither missing nor disabled aliases reveal an account's email or state.
      if (accounts.length !== 1 || !accounts[0]!.is_active || !accounts[0]!.auth_user_id ||
          !isExternalEmail(accounts[0]!.email))
        return { ok: false as const, code: "invalid-credentials" as const };
      const tokenResponse = await fetch(`${config.url}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { apikey: config.key, "content-type": "application/json" },
        body: JSON.stringify({ email: accounts[0]!.email, password: data.password }),
        signal: AbortSignal.timeout(12000),
      });
      if (!tokenResponse.ok) return { ok: false as const, code: "invalid-credentials" as const };
      const token = tokenSchema.parse(await tokenResponse.json());
      if (token.user.id !== accounts[0]!.auth_user_id)
        return { ok: false as const, code: "invalid-credentials" as const };
      return { ok: true as const, accessToken: token.access_token, refreshToken: token.refresh_token };
    } catch {
      return { ok: false as const, code: "cloud-unreachable" as const };
    }
  });
