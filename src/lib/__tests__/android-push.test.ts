import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import worker, { type Env, validSecret } from "../../../workers/android-push/index";
import { defaultAndroidPushRules, maySendAndroidPush } from "../android-push-policy";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
const databases: { close(): void }[] = [];
const secret = "a".repeat(64);
const deviceId = "11111111-1111-4111-8111-111111111111";
const eventId = "22222222-2222-4222-8222-222222222222";
let privateKey = "";
beforeAll(async () => {
  const key = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  privateKey = Buffer.from(await crypto.subtle.exportKey("pkcs8", key.privateKey)).toString(
    "base64",
  );
});
function environment() {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  db.exec(readFileSync(resolve("workers/android-push/schema.sql"), "utf8"));
  const env: Env = {
    DB: {
      prepare(sql: string) {
        const statement = db.prepare(sql);
        let values: unknown[] = [];
        return {
          bind(...input: unknown[]) {
            values = input;
            return this;
          },
          async run() {
            return statement.run(...values);
          },
          async all<T>() {
            return { results: statement.all(...values) as T[] };
          },
          async first<T>() {
            return (statement.get(...values) ?? null) as T | null;
          },
        };
      },
    },
    PUSH_TENANTS_JSON: JSON.stringify({
      companyA: { secret, callback: "https://company-a.example/api/v1/pos/push-service" },
      companyB: {
        secret: "b".repeat(64),
        callback: "https://company-b.example/api/v1/pos/push-service",
      },
    }),
    FCM_PROJECT_ID: "test-project",
    FCM_CLIENT_EMAIL: "test@example.test",
    FCM_PRIVATE_KEY: privateKey,
  };
  return { env, db };
}
async function call(env: Env, body: unknown, tenant = "companyA", credential = secret) {
  const background: Promise<unknown>[] = [];
  const response = await worker.fetch(
    new Request("https://push.example", {
      method: "POST",
      headers: { "X-POS-Tenant": tenant, Authorization: `Bearer ${credential}` },
      body: JSON.stringify(body),
    }),
    env,
    { waitUntil: (promise) => background.push(promise) },
  );
  await Promise.all(background);
  return response;
}
afterEach(() => {
  vi.unstubAllGlobals();
  for (const db of databases.splice(0)) db.close();
});
describe("central Android push isolation", () => {
  it("rejects missing, weak and cross-company credentials before touching device records", async () => {
    const { env, db } = environment();
    expect(
      (
        await call(
          env,
          { action: "register", deviceId, token: "token-".repeat(6), userId: "staff" },
          "companyB",
        )
      ).status,
    ).toBe(401);
    expect(await validSecret("Bearer short", "Bearer short")).toBe(false);
    expect(db.prepare("SELECT count(*) AS n FROM devices").get().n).toBe(0);
  });
  it("does not allow another company to take over a registered token", async () => {
    const { env } = environment();
    const body = { action: "register", deviceId, token: "token-".repeat(6), userId: "staff" };
    expect((await call(env, body)).status).toBe(200);
    expect((await call(env, body, "companyB", "b".repeat(64))).status).toBe(409);
  });
  it("checks current permissions and deduplicates an event using real SQL", async () => {
    const { env, db } = environment();
    await call(env, { action: "register", deviceId, token: "token-".repeat(6), userId: "staff" });
    const fetcher = vi.fn(async () => Response.json({ recipients: [] }));
    vi.stubGlobal("fetch", fetcher);
    await call(env, { action: "event", eventId });
    await call(env, { action: "event", eventId });
    expect(db.prepare("SELECT count(*) AS n FROM deliveries").get().n).toBe(1);
    expect(db.prepare("SELECT done FROM deliveries").get().done).toBe(1);
    expect(fetcher.mock.calls).toHaveLength(2);
    expect(fetcher).toHaveBeenLastCalledWith("https://company-a.example/api/v1/pos/push-service",expect.objectContaining({body:expect.stringContaining('"status":"skipped"')}));
  });
  it("does not send an old user's queued event to a replacement account", async () => {
    const { env, db } = environment();
    const token = "token-".repeat(6);
    await call(env, { action: "register", deviceId, token, userId: "old" });
    db.prepare(
      "INSERT INTO deliveries(tenant,event_id,device_id,user_id,token) VALUES(?,?,?,?,?)",
    ).run("companyA", eventId, deviceId, "old", token);
    await call(env, { action: "register", deviceId, token, userId: "new" });
    const fetcher = vi.fn(async () => Response.json({ recipients: ["old", "new"] }));
    vi.stubGlobal("fetch", fetcher);
    await call(env, { action: "event", eventId });
    expect(fetcher.mock.calls).toHaveLength(2);
    expect(fetcher).toHaveBeenLastCalledWith("https://company-a.example/api/v1/pos/push-service",expect.objectContaining({body:expect.stringContaining('"status":"skipped"')}));
    expect(db.prepare("SELECT done FROM deliveries").get().done).toBe(1);
  });
  it("sends generic alerts through OAuth without including financial details", async () => {
    const { env } = environment();
    await call(env, { action: "register", deviceId, token: "token-".repeat(6), userId: "staff" });
    let message: Record<string, unknown> | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, options: RequestInit) => {
        if (url.includes("company-a")) return Response.json({ recipients: ["staff"] });
        if (url.includes("oauth2")) return Response.json({ access_token: "test-access" });
        message = JSON.parse(String(options.body));
        return Response.json({ name: "sent" });
      }),
    );
    await call(env, { action: "event", eventId });
    expect(message).not.toHaveProperty("message.notification");
    expect(message).toMatchObject({message:{android:{priority:"HIGH"}}});
    expect(JSON.stringify(message)).not.toMatch(/amount|cashier|password|sale_total/);
  });
  it("retries a failed delivery receipt without sending the accepted phone message twice",async()=>{
    const {env,db}=environment();
    await call(env,{action:"register",deviceId,token:"token-".repeat(6),userId:"staff"});
    let failReceipt=true, sends=0;
    vi.stubGlobal("fetch",vi.fn(async(url:string,options:RequestInit)=>{
      if(url.includes("company-")){
        const body=JSON.parse(String(options.body));
        if(body.action==="authorize")return Response.json({recipients:["staff"]});
        if(body.action==="delivery"&&failReceipt)return new Response(null,{status:503});
        return Response.json({events:[]});
      }
      if(url.includes("oauth2"))return Response.json({access_token:"test-access"});
      sends++;return Response.json({name:"accepted"});
    }));
    await call(env,{action:"event",eventId});
    expect(sends).toBe(1);expect(db.prepare("SELECT done FROM deliveries").get().done).toBe(3);
    failReceipt=false;
    await worker.scheduled({},env);
    expect(sends).toBe(1);expect(db.prepare("SELECT done FROM deliveries").get().done).toBe(1);
  });
});
describe("company notification rules", () => {
  const admin = { id: "uuid", user_id: "admin", role: "admin", is_active: true };
  const event = { event_type: "shift_close", severity: "info", store_id: "branch" };
  const rules = {
    ...defaultAndroidPushRules,
    enabled: true,
    events: ["shift_close"],
    recipients: ["admin"],
  };
  it("requires explicit event and recipient selection", () => {
    expect(maySendAndroidPush(defaultAndroidPushRules, event, admin)).toBe(false);
    expect(maySendAndroidPush(rules, event, admin)).toBe(true);
    expect(maySendAndroidPush({ ...rules, events: [] }, event, admin)).toBe(false);
    expect(maySendAndroidPush({ ...rules, recipients: [] }, event, admin)).toBe(false);
  });
  it("preserves branch, account-state and private approval audience boundaries", () => {
    expect(maySendAndroidPush({ ...rules, branches: ["other"] }, event, admin)).toBe(false);
    expect(maySendAndroidPush(rules, event, { ...admin, is_active: false })).toBe(false);
    expect(
      maySendAndroidPush(rules, { ...event, meta: { audience_user_ids: ["other"] } }, admin),
    ).toBe(false);
  });
});
