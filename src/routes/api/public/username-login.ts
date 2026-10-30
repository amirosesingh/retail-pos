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

const MAX_BODY_BYTES = 4096;
async function readLoginBody(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const body = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(body)) as unknown;
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

export async function handleUsernameLogin(request: Request): Promise<Response> {
  const { callerVerifiedDownstream } = await import("@/lib/public-api-guard.server");
  const denied = callerVerifiedDownstream("the password is checked by Supabase Auth on the server");
  if (denied) return denied;
  const parsed = input.safeParse(await readLoginBody(request));
  if (!parsed.success || !/^[a-z0-9._-]{2,40}$/i.test(parsed.data.username)) return invalid();

  const { hasServiceKey } = await import("@/core/api/pos-relay.server");
  if (!hasServiceKey()) return Response.json(
    { ok: false, code: "central_unavailable", error: "Sign-in service unavailable" },
    { status: 503, headers: noStore },
  );

  const { throttleStatus, throttleFail, throttleReset } = await import("@/lib/pin-throttle.server");
  // Bound the complete downstream lookup/Auth/throttle work below the client
  // transport budget. Never change other consumers of the shared relay.
  const signal = AbortSignal.timeout(25_000);
  const userKey = `staff-password:${parsed.data.username.trim().toLowerCase()}`;
  // X-Forwarded-For is caller controlled when no trusted proxy overwrites it.
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const ipKey = `staff-password-ip:${ip}`;
  try {
    for (const key of [userKey, ipKey]) {
      if ((await throttleStatus(key, signal)).locked) return Response.json(
        { ok: false, code: "locked", error: "Too many attempts. Try again later." },
        { status: 429, headers: noStore },
      );
    }
    const { staffUsernameLogin } = await import("@/lib/staff-username-login.server");
    const result = await staffUsernameLogin(parsed.data.username, parsed.data.password, signal);
    if (result.ok) {
      // A successful password for one account must not clear address-wide
      // failures accumulated while guessing other accounts.
      await throttleReset(userKey, signal);
      return Response.json(result, { headers: noStore });
    }
    if (result.code === "invalid_credentials") {
      await Promise.all([throttleFail(userKey, 5, signal), throttleFail(ipKey, 5, signal)]);
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
