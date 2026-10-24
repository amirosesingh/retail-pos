type Statement = {
  bind(...values: unknown[]): Statement;
  run(): Promise<unknown>;
  all<T>(): Promise<{ results: T[] }>;
  first<T>(): Promise<T | null>;
};
type DB = { prepare(sql: string): Statement };
export type Env = {
  DB: DB;
  PUSH_TENANTS_JSON: string;
  FCM_PROJECT_ID: string;
  FCM_CLIENT_EMAIL: string;
  FCM_PRIVATE_KEY: string;
};
type Tenant = { secret: string; callback: string };
type Context = { waitUntil(promise: Promise<unknown>): void };
type Delivery = {
  tenant: string;
  event_id: string;
  device_id: string;
  user_id: string;
  token: string;
  attempts: number;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const encoder = new TextEncoder();
const base64 = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
function tenants(env: Env): Record<string, Tenant> {
  return JSON.parse(env.PUSH_TENANTS_JSON || "{}");
}
export async function validSecret(actual: string, expected: string) {
  if (expected.length < 39) return false;
  const hash = (text: string) => crypto.subtle.digest("SHA-256", encoder.encode(text));
  const [a, b] = await Promise.all([hash(actual), hash(expected)]);
  return new Uint8Array(a).every((byte, index) => byte === new Uint8Array(b)[index]);
}
async function callback(tenantId: string, env: Env, body: unknown) {
  const tenant = tenants(env)[tenantId];
  if (!tenant || new URL(tenant.callback).protocol !== "https:")
    throw new Error("Invalid company configuration");
  const response = await fetch(tenant.callback, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-POS-Tenant": tenantId,
      Authorization: `Bearer ${tenant.secret}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("Company verification unavailable");
  return response.json() as Promise<{
    recipients?: string[];
    events?: { id: string; created_at: string }[];
    cursor?: { id: string; created_at: string } | null;
  }>;
}
let oauth: { project: string; value: string; until: number } | undefined;
async function fcmAccess(env: Env) {
  if (oauth?.project === env.FCM_PROJECT_ID && oauth.until > Date.now()) return oauth.value;
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) => base64(encoder.encode(JSON.stringify(value)));
  const unsigned =
    encode({ alg: "RS256", typ: "JWT" }) +
    "." +
    encode({
      iss: env.FCM_CLIENT_EMAIL,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    });
  const pem = env.FCM_PRIVATE_KEY.replace(/\\n/g, "\n")
    .replace(/-----[^-]+-----/g, "")
    .replace(/\s/g, "");
  const key = await crypto.subtle.importKey(
    "pkcs8",
    Uint8Array.from(atob(pem), (c) => c.charCodeAt(0)),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(unsigned));
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: unsigned + "." + base64(new Uint8Array(signature)),
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("Firebase authentication unavailable");
  const data = (await response.json()) as { access_token: string };
  oauth = { project: env.FCM_PROJECT_ID, value: data.access_token, until: Date.now() + 50 * 60000 };
  return data.access_token;
}
async function enqueue(tenant: string, eventId: string, env: Env) {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO deliveries(tenant,event_id,device_id,user_id,token) SELECT tenant,?,device_id,user_id,token FROM devices WHERE tenant=? AND expires_at>?",
  )
    .bind(eventId, tenant, Date.now())
    .run();
}
async function settleDelivery(env: Env, row: Delivery, status: "sent" | "failed" | "skipped") {
  const receipt = status === "sent" ? 3 : status === "failed" ? 4 : 5;
  await env.DB.prepare("UPDATE deliveries SET done=? WHERE tenant=? AND event_id=? AND device_id=?")
    .bind(receipt, row.tenant, row.event_id, row.device_id)
    .run();
  await acknowledgeDelivery(env, row, status);
}
async function acknowledgeDelivery(env: Env, row: Delivery, status: "sent" | "failed" | "skipped") {
  try {
    await callback(row.tenant, env, {
      action: "delivery",
      eventId: row.event_id,
      userId: row.user_id,
      status,
      reason:
        status === "sent"
          ? "Accepted by Android phone service"
          : status === "failed"
            ? "Phone delivery failed after retries"
            : "Account, device or rule is no longer eligible",
    });
    await env.DB.prepare(
      "UPDATE deliveries SET done=? WHERE tenant=? AND event_id=? AND device_id=?",
    )
      .bind(status === "failed" ? 2 : 1, row.tenant, row.event_id, row.device_id)
      .run();
  } catch {
    /* Retry the receipt, never the already-accepted phone message. */
  }
}
async function reconcileDeliveryReceipts(env: Env) {
  const rows = (
    await env.DB.prepare("SELECT * FROM deliveries WHERE done IN (3,4,5) LIMIT 20").all<
      Delivery & { done: number }
    >()
  ).results;
  for (const row of rows)
    await acknowledgeDelivery(
      env,
      row,
      row.done === 3 ? "sent" : row.done === 4 ? "failed" : "skipped",
    );
}
async function processDeliveries(env: Env) {
  const rows = (
    await env.DB.prepare(
      "SELECT * FROM deliveries WHERE done=0 AND next_attempt<=? AND attempts<8 LIMIT 20",
    )
      .bind(Date.now())
      .all<Delivery>()
  ).results;
  for (const row of rows) {
    const now = Date.now();
    // Atomic lease prevents overlap between immediate and scheduled delivery.
    const claim = await env.DB.prepare(
      "UPDATE deliveries SET attempts=attempts+1,next_attempt=? WHERE tenant=? AND event_id=? AND device_id=? AND done=0 AND next_attempt<=? RETURNING attempts",
    )
      .bind(now + 60000, row.tenant, row.event_id, row.device_id, now)
      .first<{ attempts: number }>();
    if (!claim) continue;
    try {
      let deliveryStatus: "sent" | "skipped" = "skipped";
      const device = await env.DB.prepare(
        "SELECT user_id,token FROM devices WHERE tenant=? AND device_id=? AND expires_at>?",
      )
        .bind(row.tenant, row.device_id, now)
        .first<{ user_id: string; token: string }>();
      const permission = await callback(row.tenant, env, {
        action: "authorize",
        eventId: row.event_id,
      });
      if (
        device?.user_id === row.user_id &&
        device.token === row.token &&
        permission.recipients?.includes(row.user_id)
      ) {
        const response = await fetch(
          `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(env.FCM_PROJECT_ID)}/messages:send`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${await fcmAccess(env)}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              message: {
                token: row.token,
                data: { eventId: row.event_id, userId: row.user_id, tenantId: row.tenant },
                android: { ttl: "300s", priority: "HIGH" },
              },
            }),
            signal: AbortSignal.timeout(10000),
          },
        );
        if (!response.ok) {
          const error = (await response.json()) as {
            error?: { details?: { errorCode?: string }[] };
          };
          if (error.error?.details?.some((detail) => detail.errorCode === "UNREGISTERED")) {
            await env.DB.prepare("DELETE FROM devices WHERE tenant=? AND token=?")
              .bind(row.tenant, row.token)
              .run();
          } else throw new Error("Delivery unavailable");
        } else deliveryStatus = "sent";
      }
      await settleDelivery(env, row, deliveryStatus);
    } catch {
      if (claim.attempts >= 8) {
        await settleDelivery(env, row, "failed");
        continue;
      }
      await env.DB.prepare(
        "UPDATE deliveries SET next_attempt=?,done=? WHERE tenant=? AND event_id=? AND device_id=?",
      )
        .bind(
          now + Math.min(3600000, 30000 * 2 ** claim.attempts),
          claim.attempts >= 8 ? 2 : 0,
          row.tenant,
          row.event_id,
          row.device_id,
        )
        .run();
    }
  }
}
export default {
  async fetch(request: Request, env: Env, ctx: Context) {
    if (request.method === "GET" && new URL(request.url).pathname === "/health") {
      const configured = !!(
        env.FCM_PROJECT_ID &&
        env.FCM_CLIENT_EMAIL &&
        env.FCM_PRIVATE_KEY &&
        Object.keys(tenants(env)).length
      );
      return Response.json(
        { service: "retail-pos-android-push", configured },
        { status: configured ? 200 : 503 },
      );
    }
    if (request.method !== "POST") return new Response(null, { status: 405 });
    const tenantId = request.headers.get("X-POS-Tenant") ?? "";
    const tenant = tenants(env)[tenantId];
    if (
      !tenant ||
      !(await validSecret(request.headers.get("Authorization") ?? "", `Bearer ${tenant.secret}`))
    )
      return new Response(null, { status: 401 });
    const raw = await request.text();
    if (raw.length > 6000) return new Response(null, { status: 413 });
    try {
      const data = JSON.parse(raw);
      if (data.action === "event" && uuid.test(data.eventId)) {
        await enqueue(tenantId, data.eventId, env);
        ctx.waitUntil(processDeliveries(env));
      } else if (
        (data.action === "register" || data.action === "remove") &&
        uuid.test(data.deviceId) &&
        typeof data.token === "string" &&
        data.token.length >= 20 &&
        data.token.length <= 4096 &&
        typeof data.userId === "string" &&
        data.userId.length > 0 &&
        data.userId.length <= 64
      ) {
        if (data.action === "remove")
          await env.DB.prepare(
            "DELETE FROM devices WHERE tenant=? AND device_id=? AND token=? AND user_id=?",
          )
            .bind(tenantId, data.deviceId, data.token, data.userId)
            .run();
        else {
          const existing = await env.DB.prepare("SELECT tenant FROM devices WHERE token=?")
            .bind(data.token)
            .first<{ tenant: string }>();
          if (existing && existing.tenant !== tenantId) return new Response(null, { status: 409 });
          await env.DB.prepare(
            "INSERT INTO devices(tenant,device_id,token,user_id,expires_at) VALUES(?,?,?,?,?) ON CONFLICT(tenant,device_id) DO UPDATE SET token=excluded.token,user_id=excluded.user_id,expires_at=excluded.expires_at",
          )
            .bind(tenantId, data.deviceId, data.token, data.userId, Date.now() + 30 * 86400000)
            .run();
        }
      } else return new Response(null, { status: 400 });
      return Response.json({ ok: true });
    } catch {
      return Response.json({ error: "Push operation unavailable" }, { status: 503 });
    }
  },
  async scheduled(_event: unknown, env: Env) {
    for (const tenant of Object.keys(tenants(env))) {
      try {
        const cursor = await env.DB.prepare("SELECT at,id FROM cursors WHERE tenant=?")
          .bind(tenant)
          .first<{ at: string; id: string }>();
        const after = cursor?.at ?? new Date(Date.now() - 5 * 60000).toISOString();
        const result = await callback(tenant, env, {
          action: "poll",
          after,
          ...(cursor?.id ? { afterId: cursor.id } : {}),
        });
        for (const event of result.events ?? []) await enqueue(tenant, event.id, env);
        const last = result.cursor ?? result.events?.at(-1);
        if (last)
          await env.DB.prepare(
            "INSERT INTO cursors(tenant,at,id) VALUES(?,?,?) ON CONFLICT(tenant) DO UPDATE SET at=excluded.at,id=excluded.id",
          )
            .bind(tenant, last.created_at, last.id)
            .run();
      } catch {
        /* Keep cursor unchanged so the next run retries this company. */
      }
    }
    await processDeliveries(env);
    await reconcileDeliveryReceipts(env);
    await env.DB.prepare("DELETE FROM devices WHERE expires_at<=?").bind(Date.now()).run();
    await env.DB.prepare("DELETE FROM deliveries WHERE done<>0 AND created_at<?")
      .bind(Date.now() - 30 * 86400000)
      .run();
  },
};
