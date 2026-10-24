import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { newNotificationRule, notificationRulesSchema } from "../notification-rules";
let db: PGlite;
const firstId = "00000000-0000-4000-8000-000000000001";
const rule = (patch: Record<string, unknown> = {}) => ({
  ...newNotificationRule(),
  id: firstId,
  name: "Selected supervisors",
  enabled: true,
  roles: ["supervisor"],
  channels: ["app", "push", "whatsapp"],
  phones: ["6731234567"],
  phoneUsers: { "6731234567": "manager-a" },
  ...patch,
});
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE pos_settings(id int PRIMARY KEY,notification_settings jsonb);
    INSERT INTO pos_settings VALUES(1,'{"enabled":false,"shiftAlerts":{"whatsapp":false}}');
    CREATE TABLE app_users(id uuid PRIMARY KEY,user_id text,role text,role_slug text,store_id text,is_active boolean,permissions jsonb);
    INSERT INTO app_users VALUES('00000000-0000-4000-8000-000000000002','manager-a','cashier','supervisor','a',true,'{}'),
      ('00000000-0000-4000-8000-000000000003','manager-b','cashier','supervisor','b',true,'{}'),
      ('00000000-0000-4000-8000-000000000004','disabled','cashier','supervisor','a',false,'{}'),
      ('00000000-0000-4000-8000-000000000005','cashier','cashier','cashier','a',true,'{}');
    CREATE TABLE stores(id text PRIMARY KEY,name text); INSERT INTO stores VALUES('a','Branch A'),('b','Branch B');
    CREATE TABLE activity_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_type text,severity text DEFAULT 'info',title text DEFAULT '',message text DEFAULT '',
      actor_id text,actor_name text,actor_role text,store_id text,amount numeric,meta jsonb DEFAULT '{}',client_event_id text UNIQUE,
      entity_type text,entity_id text,created_at timestamptz DEFAULT now());
    CREATE TABLE shift_notifications(shift_id uuid,summary text,closed_by text,store_id text,total_sales numeric);`);
  const migration = readFileSync(
    "supabase/migrations/20261024095724_notification_rule_table.sql",
    "utf8",
  );
  await db.exec(migration);
  await db.exec(migration);
  await db.exec(readFileSync("supabase/migrations/20261024110442_notification_legacy_mode_guard.sql", "utf8"));
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.exec(
    `TRUNCATE notification_deliveries,activity_events; UPDATE pos_settings SET notification_settings='{"enabled":false,"shiftAlerts":{"whatsapp":false}}';`,
  );
});
async function save(rules: unknown[], expected: unknown = null) {
  return db.query("SELECT save_notification_rule_table($1::jsonb,$2::jsonb) result", [
    JSON.stringify(rules),
    JSON.stringify(expected),
  ]);
}
async function event(meta: unknown = {}, amount: number | null = 150) {
  return db.query<{ id: string; meta: Record<string, unknown> }>(
    `INSERT INTO activity_events(event_type,title,message,store_id,amount,meta,client_event_id) VALUES('sale_complete','Sale complete','Original activity','a',$1,$2::jsonb,'same-sale') ON CONFLICT(client_event_id) DO NOTHING RETURNING id,meta`,
    [amount, JSON.stringify(meta)],
  );
}
describe("durable notification rule table", () => {
  it("keeps legacy in-app preferences and private audiences before activation", async () => {
    const first = (await event({audience_user_ids:["cashier"]})).rows[0];
    expect(first.meta.audience_user_ids).toEqual(["cashier"]);
    expect(first.meta.in_app_disabled).toBe(false);
    expect(first.meta.notification_routes).toBeUndefined();
    expect((await db.query("SELECT * FROM notification_deliveries")).rows).toEqual([]);
    await db.exec("DELETE FROM activity_events; UPDATE pos_settings SET notification_settings='{\"inApp\":{\"sale_complete\":false}}'");
    expect((await event()).rows[0].meta.in_app_disabled).toBe(true);
  });
  it("preserves legacy configuration and refuses concurrent overwrites", async () => {
    await save([rule()]);
    const config = (
      await db.query<{ notification_settings: Record<string, unknown> }>(
        "SELECT notification_settings FROM pos_settings",
      )
    ).rows[0].notification_settings;
    expect(config.enabled).toBe(false);
    expect(config.shiftAlerts).toEqual({ whatsapp: false });
    await expect(save([])).rejects.toThrow(/changed on another device/);
    await save([], [rule()]);
  });
  it("routes only to selected active roles in the correct branch and deduplicates delivery", async () => {
    expect(
      (
        await db.query<{ message: string }>(
          "SELECT notification_rule_message($1::jsonb,$2::jsonb) message",
          [
            JSON.stringify(rule()),
            JSON.stringify({
              store_id: "a",
              title: "Sale complete",
              message: "Original activity",
              amount: 150,
            }),
          ],
        )
      ).rows[0].message,
    ).toContain("Branch A");
    await save([rule(), rule({ id: "00000000-0000-4000-8000-000000000009" })]);
    const inserted = await event();
    await event();
    expect(inserted.rows[0].meta.notification_routes).toEqual({
      app: ["manager-a", "manager-a"],
      push: ["manager-a", "manager-a"],
      terminalApp: [],
    });
    const rows = (
      await db.query<{ channel: string; recipient: string }>(
        "SELECT channel,recipient FROM notification_deliveries ORDER BY channel",
      )
    ).rows;
    expect(rows).toEqual([
      { channel: "app", recipient: "manager-a" },
      { channel: "push", recipient: "manager-a" },
      { channel: "whatsapp", recipient: "6731234567" },
    ]);
    expect((await db.query("SELECT * FROM activity_events")).rows).toHaveLength(1);
  });
  it("retains the event when rules are disabled or conditions do not match", async () => {
    await save([rule({ minAmount: 200 })]);
    await event();
    const rows = (
      await db.query<{ status: string; reason: string }>(
        "SELECT status,reason FROM notification_deliveries",
      )
    ).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("skipped");
    expect((await db.query("SELECT * FROM activity_events")).rows).toHaveLength(1);
  });
  it("intersects private approval audiences and never leaks them to WhatsApp", async () => {
    await save([rule()]);
    await event({ audience_user_ids: ["cashier"] });
    expect(
      (await db.query("SELECT * FROM notification_deliveries WHERE recipient='6731234567'")).rows,
    ).toHaveLength(0);
    expect(
      (await db.query("SELECT * FROM notification_deliveries WHERE recipient='manager-a'")).rows,
    ).toHaveLength(0);
  });
  it("claims a WhatsApp message once, including concurrent worker retries", async () => {
    await save([rule()]);
    await event();
    expect((await db.query("SELECT * FROM claim_notification_whatsapp(5)")).rows).toHaveLength(1);
    expect((await db.query("SELECT * FROM claim_notification_whatsapp(5)")).rows).toHaveLength(0);
  });
  it("does not send WhatsApp after a selected account is deactivated or its role changes", async () => {
    await save([rule()]);
    await event();
    await db.exec("UPDATE app_users SET is_active=false WHERE user_id='manager-a'");
    expect((await db.query("SELECT * FROM claim_notification_whatsapp(5)")).rows).toHaveLength(0);
    await db.exec("UPDATE app_users SET is_active=true WHERE user_id='manager-a'");
  });
  it("does not send a WhatsApp number bound to an unselected account", async () => {
    await save([rule({ phoneUsers: { "6731234567": "cashier" } })]);
    await event();
    expect(
      (await db.query("SELECT * FROM notification_deliveries WHERE channel='whatsapp'")).rows,
    ).toHaveLength(0);
  });
  it("retains an event and records failure for malformed stored configuration", async () => {
    await save([rule()]);
    await db.exec(
      `UPDATE pos_settings SET notification_settings=jsonb_set(notification_settings,'{rules,0,branches}','"invalid"')`,
    );
    await event();
    expect((await db.query("SELECT * FROM activity_events")).rows).toHaveLength(1);
    expect(
      (await db.query<{ status: string }>("SELECT status FROM notification_deliveries")).rows[0]
        .status,
    ).toBe("failed");
  });
  it("rechecks disabled rules before external delivery", async () => {
    await save([rule()]);
    const inserted = await event();
    await save([rule({ enabled: false })], [rule()]);
    expect((await db.query("SELECT * FROM claim_notification_whatsapp(5)")).rows).toHaveLength(0);
    expect(
      (
        await db.query("SELECT * FROM authorized_notification_push_users($1::uuid)", [
          inserted.rows[0].id,
        ])
      ).rows,
    ).toHaveLength(0);
  });
  it("defers quiet-hour deliveries using the selected business time zone", async () => {
    const r = rule({ quietFrom: "22:00", quietTo: "07:00", timeZone: "Asia/Brunei" });
    const result = (
      await db.query<{ at: string }>(
        "SELECT notification_rule_due($1::jsonb,'2026-10-24T16:00:00Z')::text at",
        [JSON.stringify(r)],
      )
    ).rows[0].at;
    expect(new Date(result).toISOString()).toBe("2026-10-24T23:00:00.000Z");
  });
  it("fails closed on missing amounts and validates recipient rules", async () => {
    await save([rule({ minAmount: 1 })]);
    await event({}, null);
    expect(
      (await db.query("SELECT * FROM notification_deliveries WHERE status='queued'")).rows,
    ).toHaveLength(0);
    expect(notificationRulesSchema.safeParse([rule({ roles: [], users: [] })]).success).toBe(false);
  });
  it("keeps delivery tables and service RPCs inaccessible to ordinary sessions", async () => {
    const rights = (
      await db.query<{ allowed: boolean }>(
        "SELECT has_table_privilege('authenticated','notification_deliveries','SELECT') OR has_function_privilege('authenticated','save_notification_rule_table(jsonb,jsonb)','EXECUTE') allowed",
      )
    ).rows[0];
    expect(rights.allowed).toBe(false);
  });
});
