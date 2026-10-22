import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { corsPreflight, withCors } from "@/lib/public-cors";

const input = z.object({
  username: z.string().min(2).max(40),
  password: z.string().min(1).max(1024),
});

const noStore = { "Cache-Control": "no-store" };
const invalid = () => Response.json(
  { ok: false, code: "invalid_credentials", error: "Invalid username or password" },
  { status: 401, headers: noStore },
);

export async function handleUsernameLogin(request: Request): Promise<Response> {
  const { callerVerifiedDownstream } = await import("@/lib/public-api-guard.server");
  const denied = callerVerifiedDownstream("the password is checked by Supabase Auth on the server");
  if (denied) return denied;
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !/^[a-z0-9._-]{2,40}$/i.test(parsed.data.username)) return invalid();

  const { hasServiceKey } = await import("@/core/api/pos-relay.server");
  if (!hasServiceKey()) return Response.json(
    { ok: false, code: "central_unavailable", error: "Sign-in service unavailable" },
    { status: 503, headers: noStore },
  );

  const { throttleStatus, throttleFail, throttleReset } = await import("@/lib/pin-throttle.server");
  const userKey = `staff-password:${parsed.data.username.trim().toLowerCase()}`;
  const ip = request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const ipKey = `staff-password-ip:${ip}`;
  try {
    for (const key of [userKey, ipKey]) {
      if ((await throttleStatus(key)).locked) return Response.json(
        { ok: false, code: "locked", error: "Too many attempts. Try again later." },
        { status: 429, headers: noStore },
      );
    }
    const { staffUsernameLogin } = await import("@/lib/staff-username-login.server");
    const result = await staffUsernameLogin(parsed.data.username, parsed.data.password);
    if (result.ok) {
      await Promise.all([throttleReset(userKey), throttleReset(ipKey)]);
      return Response.json(result, { headers: noStore });
    }
    if (result.code === "invalid_credentials") {
      await Promise.all([throttleFail(userKey), throttleFail(ipKey)]);
      return invalid();
    }
  } catch {
    // A failed database lookup or throttle check is never treated as a wrong password.
  }
  return Response.json(
    { ok: false, code: "central_unavailable", error: "Sign-in service unavailable" },
    { status: 503, headers: noStore },
  );
}

export const Route = createFileRoute("/api/public/username-login")({
  server: {
    handlers: {
      POST: async ({ request }) => withCors(await handleUsernameLogin(request), request),
      OPTIONS: async ({ request }) => corsPreflight(request),
    },
  },
});
