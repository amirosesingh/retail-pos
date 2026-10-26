import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";

let db: PGlite;
const id = "00000000-0000-4000-8000-000000000001";
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE activity_events(id uuid PRIMARY KEY,event_type text,severity text,title text,message text,
      actor_id text,actor_name text,actor_role text,terminal_id text,terminal_name text,store_id text,
      entity_type text,entity_id text,amount numeric,meta jsonb,whatsapp_status text,whatsapp_error text,
      client_event_id text,created_at timestamptz,previous_state jsonb,new_state jsonb,cleared_by text[],branch_id text);
    INSERT INTO activity_events(id,title,cleared_by) VALUES('${id}','Original event','{}');`);
  const migration = readFileSync("supabase/migrations/20261025141638_personal_notification_acknowledgements.sql", "utf8");
  await db.exec(migration);
  await db.exec(migration);
});
afterAll(async () => { await db.close(); });

it("merges separate recipient acknowledgements and preserves them through stale offline snapshots", async () => {
  for (const ids of [["person-a"], ["person-b"], [], ["person-a"]]) {
    await db.query("SELECT sync_apply_activity_events($1::jsonb)", [JSON.stringify([{ id, title: "Untrusted replacement", cleared_by: ids }])]);
  }
  const event = (await db.query<{ title: string; cleared_by: string[] }>("SELECT title,cleared_by FROM activity_events")).rows;
  expect(event).toHaveLength(1);
  expect(event[0].title).toBe("Original event");
  expect(event[0].cleared_by.sort()).toEqual(["person-a", "person-b"]);
});

it("retains system resolution when an older device uploads an acknowledgement", async () => {
  await db.exec("UPDATE activity_events SET cleared_by=array_append(cleared_by,'system:approval-resolved')");
  await db.query("SELECT sync_apply_activity_events($1::jsonb)", [JSON.stringify([{ id, cleared_by: ["person-a"] }])]);
  const event = (await db.query<{ cleared_by: string[] }>("SELECT cleared_by FROM activity_events")).rows[0];
  expect(event.cleared_by).toContain("system:approval-resolved");
});

it("does not grant ordinary clients the raw synchronization write routine", async () => {
  const permissions = (await db.query<{ allowed: boolean }>("SELECT has_function_privilege('authenticated','sync_apply_activity_events(jsonb)','EXECUTE') AS allowed")).rows[0];
  expect(permissions.allowed).toBe(false);
});
