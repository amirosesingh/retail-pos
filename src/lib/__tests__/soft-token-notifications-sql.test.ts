import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, expect, it } from "vitest";
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE TABLE pos_settings(id int, notification_settings jsonb);
    INSERT INTO pos_settings VALUES(1,'{}');
    CREATE TABLE authorization_log(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), action_key text,
      outcome text, authorized_by text, requested_by text, authorizer_role text, terminal_id text,
      store_id text, detail jsonb, created_at timestamptz DEFAULT now());
    CREATE TABLE activity_events(event_type text, severity text, title text, message text,
      actor_id text, actor_name text, actor_role text, terminal_id text, store_id text,
      entity_type text, entity_id text, meta jsonb, client_event_id text UNIQUE, created_at timestamptz);`);
  const migration = readFileSync("supabase/migrations/20261023141539_soft_token_approval_notifications.sql", "utf8");
  await db.exec(migration);
  await db.exec(migration);
});
afterAll(async () => { await db.close(); });
const approve = (outcome: string, method: string, owner: string) => db.query(`INSERT INTO authorization_log
  (action_key,outcome,authorized_by,requested_by,authorizer_role,terminal_id,store_id,detail)
  VALUES('discount_over_limit',$1,$2,'cashier','manager','pc','branch-a',
    jsonb_build_object('credential_method',$3::text,'approved_by_name',$2::text,'requested_by_name','Cashier','ticket_reference','BILL-1'))`,
  [outcome, owner, method]);
it("notifies the exact token owner for each successful approval, never failed or PIN attempts", async () => {
  await approve("approved", "totp", "manager-a");
  await approve("approved", "totp", "manager-b");
  await approve("failed_pin", "totp", "manager-a");
  await approve("approved", "pin", "manager-a");
  const rows = (await db.query<{meta: {audience_user_ids: string[];ticket_reference: string};message:string}>(
    "SELECT meta,message FROM activity_events ORDER BY actor_id")).rows;
  expect(rows).toHaveLength(2);
  expect(rows[0].meta.audience_user_ids).toEqual(["manager-a"]);
  expect(rows[1].meta.audience_user_ids).toEqual(["manager-b"]);
  expect(rows[0].meta.ticket_reference).toBe("BILL-1");
  expect(rows[0].message).toContain("Cashier");
});
it("honors the saved preference without suppressing the approval audit record", async () => {
  await db.exec(`UPDATE pos_settings SET notification_settings='{"inApp":{"soft_token_approval":false}}'`);
  const before = (await db.query("SELECT * FROM activity_events")).rows.length;
  await approve("approved", "totp", "manager-c");
  expect((await db.query("SELECT * FROM activity_events")).rows.length).toBe(before);
  expect((await db.query("SELECT * FROM authorization_log WHERE authorized_by='manager-c'")).rows).toHaveLength(1);
});

it("applies in-app preferences to events written by SQL without deleting their history", async () => {
  await db.exec(`UPDATE pos_settings SET notification_settings='{"inApp":{"sale_complete":false}}';
    INSERT INTO activity_events(event_type,meta) VALUES('sale_complete','{}'),('transfer_sent','{}')`);
  const rows = (await db.query<{event_type:string;meta:{in_app_disabled:boolean}}>(
    "SELECT event_type,meta FROM activity_events WHERE event_type IN ('sale_complete','transfer_sent') ORDER BY event_type")).rows;
  expect(rows[0].meta.in_app_disabled).toBe(true);
  expect(rows[1].meta.in_app_disabled).toBe(false);
});
