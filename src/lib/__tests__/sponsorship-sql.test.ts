import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, beforeEach, expect, it } from "vitest";
let db: PGlite;
const id = "00000000-0000-4000-8000-000000000010",
  product = "00000000-0000-4000-8000-000000000020";
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE SCHEMA auth;CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT 'service_role' $$;
 CREATE SCHEMA private;CREATE TABLE private.stock_document_counters(prefix text PRIMARY KEY,store_id text,next_value bigint,updated_at timestamptz);
 CREATE TABLE stock_count_drafts(reference text);CREATE TABLE purchase_orders(reference text);CREATE TABLE stock_transfers(ref text);
 CREATE TABLE app_users(id uuid DEFAULT gen_random_uuid(),user_id text,full_name text,role text,role_slug text,store_id text,is_active boolean,permissions jsonb);
 CREATE TABLE stores(id text PRIMARY KEY,name text,is_active boolean,archived_at timestamptz);
 CREATE TABLE products(id uuid PRIMARY KEY,name text,sku text,barcode text,is_archived boolean,owner_store_id text,selling_price numeric,cost_price numeric,stock_by_store jsonb,stock_quantity int,updated_at timestamptz);
 CREATE TABLE authorization_requests(id uuid PRIMARY KEY,action_key text,status text,consumed_at timestamptz,expires_at timestamptz,requested_by text,store_id text,decided_by text,decided_by_name text,payload jsonb,requested_amount numeric,approved_amount numeric,updated_at timestamptz,decision_note text);
 CREATE TABLE authorization_log(request_id uuid,outcome text,authorized_by text,action_key text,mode_used text,requested_by text,authorizer_role text,store_id text,detail jsonb);
 CREATE TABLE authorization_actions(action_key text,mode text,is_enabled boolean,require_reason boolean,threshold numeric);
 CREATE TABLE stock_adjustments(id uuid PRIMARY KEY,product_id uuid,product_name text,sku text,barcode text,store_id text,reason text,note text,previous_stock int,updated_stock int,delta int,cost_impact numeric,staff_id text,staff_name text,role text);
 CREATE TABLE item_activity_logs(id uuid PRIMARY KEY,product_id uuid,product_name text,sku text,barcode text,store_id text,activity_type text,reference text,quantity_delta int,stock_before int,stock_after int,unit_cost numeric,staff_id text,staff_name text,role text,note text);
 CREATE TABLE activity_events(event_type text,severity text,title text,message text,store_id text,actor_id text,actor_name text,actor_role text,entity_type text,entity_id text,amount numeric,client_event_id text UNIQUE);
 CREATE TABLE stock_delta_applied(movement_id uuid PRIMARY KEY,product_id uuid,store_id text,delta int);
 CREATE FUNCTION store_visible(s text) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;`);
  const schema = readFileSync("supabase/schema.sql", "utf8");
  const helper = schema.match(
    /CREATE OR REPLACE FUNCTION public.stock_apply_delta\([\s\S]*?\n\$\$;/,
  );
  if (!helper) throw new Error("Stock helper not found");
  await db.exec(helper[0]);
  await db.exec(
    readFileSync(
      "supabase/migrations/20261024120332_mandatory_sponsorship_stock_issues.sql",
      "utf8",
    ),
  );
  await db.exec(
    readFileSync("supabase/migrations/20261024123525_sponsorship_line_discounts.sql", "utf8"),
  );
  await db.exec(
    readFileSync(
      "supabase/migrations/20261024124905_sponsorship_direct_issue_and_numbering.sql",
      "utf8",
    ),
  );
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.exec(`UPDATE sponsorship_direct_issue_policy SET user_ids='{}',row_version=0; TRUNCATE private.stock_document_counters,stock_delta_applied,sponsorship_issues,app_users,products,authorization_requests,authorization_log,authorization_actions,stock_adjustments,item_activity_logs,activity_events,stores CASCADE;
 INSERT INTO stores VALUES('a','Shop A',true,null),('b','Warehouse B',true,null);
 INSERT INTO app_users(user_id,full_name,role,role_slug,store_id,is_active,permissions) VALUES
 ('issuer','Issuer','cashier','cashier','a',true,'{"can_create_sponsorship":true,"can_issue_sponsorship":true}'),
 ('approver','Approver','cashier','supervisor',null,true,'{"can_approve_sponsorship":true}'),
 ('unprivileged','Unprivileged','cashier','cashier','a',true,'{}'),('owner','Owner','admin','admin',null,true,'{}');
 INSERT INTO products VALUES('${product}','Shuttle','SKU','BAR',false,null,10,7,'{"a":10,"b":5}',15,now());`);
});
async function prepare(
  actor = "issuer",
  store = "a",
  quantity = 2,
  discount = 0,
  discountType = "amount",
) {
  return (
    await db.query<{ result: Record<string, unknown> }>(
      "select prepare_sponsorship($1,$2,'Club','contact','Sports event',$3::jsonb,$4) result",
      [
        id,
        store,
        JSON.stringify([{ productId: product, quantity, discount, discountType }]),
        actor,
      ],
    )
  ).rows[0].result;
}
async function approve(actor = "approver") {
  await db.query(
    `INSERT INTO authorization_requests(id,action_key,status,consumed_at,expires_at,requested_by,store_id,decided_by,decided_by_name,payload,requested_amount,approved_amount,updated_at) SELECT id,'sponsorship','approved',null,now()+interval '1 hour',created_by,store_id,$1,'Approver',jsonb_build_object('sponsorship_id',id,'document_hash',document_hash),total_value,total_value,now() FROM sponsorship_issues`,
    [actor],
  );
  await db.query(
    "INSERT INTO authorization_log(request_id,outcome,authorized_by) VALUES($1,'requested',null),($1,'approved',$2)",
    [id, actor],
  );
}
async function issue(actor = "issuer") {
  return db.query<{ result: Record<string, unknown> }>(
    "select issue_sponsorship($1,$2,'Actual receiver') result",
    [id, actor],
  );
}
async function stock() {
  return (await db.query<{ n: number }>("select (stock_by_store->>'a')::int n from products"))
    .rows[0].n;
}
it.each([0, 1, 100])("requires a separate approval even at value %s", async (value) => {
  await db.query("update products set selling_price=$1", [value]);
  await prepare();
  await expect(issue()).rejects.toThrow(/requires.*approval/);
  expect(await stock()).toBe(10);
});
it("derives value from database and records recipient, issuer, approver and time; replay does not deduct twice", async () => {
  const doc = await prepare();
  expect(doc.total_value).toBe(20);
  expect(await stock()).toBe(10);
  await approve();
  const saved = (await issue()).rows[0].result;
  expect(saved).toMatchObject({
    status: "issued",
    recipient_name: "Club",
    received_by: "Actual receiver",
    given_by: "issuer",
    approved_by_name: "Approver",
  });
  expect(saved.given_at).toBeTruthy();
  expect(await stock()).toBe(8);
  expect((await issue()).rows[0].result).toEqual(saved);
  expect(await stock()).toBe(8);
  expect((await db.query("select * from stock_adjustments")).rows).toHaveLength(1);
  expect((await db.query("select * from item_activity_logs")).rows).toHaveLength(1);
});
it("denies absent permissions, hidden page, wrong branch and self approval", async () => {
  await expect(prepare("unprivileged")).rejects.toThrow(/permission/);
  await db.exec(
    `UPDATE app_users SET permissions=permissions||'{"page:sponsorship":false}' WHERE user_id='issuer'`,
  );
  await expect(prepare()).rejects.toThrow(/permission/);
  await db.exec(
    `UPDATE app_users SET permissions=permissions-'page:sponsorship' WHERE user_id='issuer'`,
  );
  await expect(prepare("issuer", "b")).rejects.toThrow(/branch/);
  await prepare();
  await approve("issuer");
  await expect(issue()).rejects.toThrow(/separate/);
});
it("denies unprivileged handover and revoked approval permission", async () => {
  await prepare();
  await approve();
  await expect(issue("unprivileged")).rejects.toThrow(/permission/);
  await db.exec("update app_users set permissions='{}' where user_id='approver'");
  await expect(issue()).rejects.toThrow(/approval permission/);
  expect(await stock()).toBe(10);
});
it.each([
  "status='rejected'",
  "expires_at=now()-interval '1 second'",
  "payload='{}'",
  "approved_amount=1",
  "consumed_at=now()",
])("rejects invalid approval: %s", async (mutation) => {
  await prepare();
  await approve();
  await db.exec(`update authorization_requests set ${mutation}`);
  await expect(issue()).rejects.toThrow(/approval/);
  expect(await stock()).toBe(10);
});
it("requires approval audit and respects explicit approval branch scope", async () => {
  await prepare();
  await approve();
  await db.exec("delete from authorization_log where outcome='approved'");
  await expect(issue()).rejects.toThrow(/audit/);
  await db.query(
    "insert into authorization_log(request_id,outcome,authorized_by) values($1,'approved','approver')",
    [id],
  );
  await db.exec(
    `update app_users set permissions=permissions||'{"approval_scope:configured":true,"approval_scope:branch:b":true}' where user_id='approver'`,
  );
  await expect(issue()).rejects.toThrow(/branch scope/);
});
it("rolls back the handover when current stock is insufficient", async () => {
  await prepare();
  await approve();
  await db.exec(`update products set stock_by_store='{"a":1}'`);
  await expect(issue()).rejects.toThrow(/Not enough stock/);
  expect((await db.query("select status from sponsorship_issues")).rows[0]).toEqual({
    status: "requested",
  });
  expect((await db.query("select consumed_at from authorization_requests")).rows[0]).toEqual({
    consumed_at: null,
  });
  expect((await db.query("select * from stock_adjustments")).rows).toEqual([]);
});
it("preserves identical retries and refuses a changed document under the same reference", async () => {
  const first = await prepare();
  expect(await prepare()).toEqual(first);
  await expect(prepare("issuer", "a", 3)).rejects.toThrow(/different details/);
});
it("forbids disabling mandatory approval or setting a bypass threshold", async () => {
  await expect(
    db.exec("insert into authorization_actions values('sponsorship','none',true,true,null)"),
  ).rejects.toThrow(/always requires/);
  await expect(
    db.exec("insert into authorization_actions values('sponsorship','request',true,true,100)"),
  ).rejects.toThrow(/always requires/);
  await db.exec("insert into authorization_actions values('sponsorship','request',true,true,null)");
});
it("exposes neither records nor mutation RPCs to public clients", async () => {
  const result = await db.query<{ rls: boolean; read: boolean; execute: boolean }>(
    `select (select relrowsecurity from pg_class where oid='sponsorship_issues'::regclass) rls,has_table_privilege('authenticated','sponsorship_issues','SELECT') read,has_function_privilege('anon','issue_sponsorship(uuid,text,text)','EXECUTE') execute`,
  );
  expect(result.rows[0]).toEqual({ rls: true, read: false, execute: false });
});

it("aggregates only actual handovers in the configured business day and branch", async () => {
  await prepare();
  expect(
    (
      await db.query(
        "select * from sponsorship_daily_values('a','2026-10-24','2026-10-24','Asia/Brunei')",
      )
    ).rows,
  ).toEqual([]);
  await approve();
  await issue();
  await db.exec("update sponsorship_issues set given_at='2026-10-23T17:00:00Z'");
  expect(
    (
      await db.query(
        "select * from sponsorship_daily_values('a','2026-10-24','2026-10-24','Asia/Brunei')",
      )
    ).rows,
  ).toEqual([{ day: "2026-10-24", value: "20.00" }]);
  expect(
    (
      await db.query(
        "select * from sponsorship_daily_values('b','2026-10-24','2026-10-24','Asia/Brunei')",
      )
    ).rows,
  ).toEqual([]);
  expect(
    (await db.query("select * from sponsorship_daily_values('a','2026-10-24','2026-10-24','UTC')"))
      .rows,
  ).toEqual([]);
});

it.each([
  [5, "amount", 15],
  [25, "percent", 15],
  [100, "percent", 0],
])("binds discount %s %s to the exact approved value", async (discount, type, expected) => {
  const doc = await prepare("issuer", "a", 2, Number(discount), String(type));
  expect(doc.total_value).toBe(expected);
  expect(await stock()).toBe(10);
  await expect(issue()).rejects.toThrow(/approval/);
  await approve();
  await issue();
  expect(await stock()).toBe(8);
});
it.each([
  [21, "amount"],
  [101, "percent"],
  [-1, "amount"],
])("rejects invalid sponsorship discount %s %s", async (discount, type) => {
  await expect(prepare("issuer", "a", 2, Number(discount), String(type))).rejects.toThrow(
    /discount/,
  );
  expect((await db.query("select * from sponsorship_issues")).rows).toEqual([]);
});
it("refuses changing an already requested discount under the same reference", async () => {
  await prepare("issuer", "a", 2, 5, "amount");
  await expect(prepare("issuer", "a", 2, 6, "amount")).rejects.toThrow(/different details/);
});
it("rolls back earlier product deductions if a later line has insufficient stock", async () => {
  const second = "00000000-0000-4000-8000-000000000030";
  await db.query(
    "insert into products select $1,'Second','SKU2','BAR2',false,null,10,7,'{\"a\":10}',10,now()",
    [second],
  );
  await db.query("select prepare_sponsorship($1,'a','Club','','Sports event',$2::jsonb,'issuer')", [
    id,
    JSON.stringify([
      { productId: product, quantity: 2 },
      { productId: second, quantity: 2 },
    ]),
  ]);
  await approve();
  await db.query("update products set stock_by_store='{\"a\":1}' where id=$1", [second]);
  await expect(issue()).rejects.toThrow(/stock/);
  expect(
    (
      await db.query<{ n: number }>(
        "select (stock_by_store->>'a')::int n from products where id=$1",
        [product],
      )
    ).rows[0].n,
  ).toBe(10);
  expect((await db.query("select * from stock_delta_applied")).rows).toEqual([]);
  expect((await db.query("select * from stock_adjustments")).rows).toEqual([]);
});

it("lets administrators issue directly and records the direct authorization", async () => {
  await prepare("owner");
  const result = (await issue("owner")).rows[0].result;
  expect(result).toMatchObject({
    authorization_mode: "direct",
    status: "issued",
    given_by: "owner",
    approved_by_name: "Owner (direct issue)",
  });
  expect(await stock()).toBe(8);
});
it("grants direct issue only to explicitly selected users with the ordinary action permissions", async () => {
  await db.query("select save_sponsorship_direct_issuers($1::text[],0,'owner')", [
    ["issuer", "unprivileged"],
  ]);
  await prepare();
  expect((await issue()).rows[0].result.authorization_mode).toBe("direct");
  await expect(issue("unprivileged")).rejects.toThrow(/permission/);
});
it("revoking direct issue restores the approval requirement immediately", async () => {
  await db.query("select save_sponsorship_direct_issuers($1::text[],0,'owner')", [["issuer"]]);
  await prepare();
  await db.exec("select save_sponsorship_direct_issuers('{}',1,'owner')");
  await expect(issue()).rejects.toThrow(/approval/);
  expect(await stock()).toBe(10);
});
it("protects direct issuer settings against non-admins, inactive users and stale saves", async () => {
  await expect(
    db.exec("select save_sponsorship_direct_issuers('{issuer}',0,'issuer')"),
  ).rejects.toThrow(/Administrator/);
  await expect(
    db.exec("select save_sponsorship_direct_issuers('{missing}',0,'owner')"),
  ).rejects.toThrow(/active/);
  await db.exec("select save_sponsorship_direct_issuers('{issuer}',0,'owner')");
  await expect(db.exec("select save_sponsorship_direct_issuers('{}',0,'owner')")).rejects.toThrow(
    /changed/,
  );
});
it("cancels a pending request with an audit when an authorized administrator hands it over directly", async () => {
  await prepare();
  await approve();
  await db.exec("update authorization_requests set status='pending',decided_by=null");
  await issue("owner");
  expect((await db.query("select status from authorization_requests")).rows[0]).toEqual({
    status: "cancelled",
  });
  expect(
    (await db.query("select outcome from authorization_log where outcome='cancelled'")).rows,
  ).toHaveLength(1);
});
it("reserves configured document numbers atomically and keeps a retry on the same reference", async () => {
  const args = [
    id,
    "a",
    "Club",
    "",
    "Sports event",
    JSON.stringify([{ productId: product, quantity: 2 }]),
    "issuer",
    "SP-A-20261024",
    41,
    5,
  ];
  const sql = "select prepare_numbered_sponsorship($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10) result";
  const first = (await db.query<{ result: { reference: string } }>(sql, args)).rows[0].result;
  expect(first.reference).toBe("SP-A-20261024-00041");
  expect(
    (await db.query<{ result: { reference: string } }>(sql, args)).rows[0].result.reference,
  ).toBe(first.reference);
  const next = [...args];
  next[0] = "00000000-0000-4000-8000-000000000011";
  expect(
    (await db.query<{ result: { reference: string } }>(sql, next)).rows[0].result.reference,
  ).toBe("SP-A-20261024-00042");
});
it("refuses a numbering prefix owned by another branch without leaving a partial draft", async () => {
  await db.exec("insert into private.stock_document_counters values('SP-B','b',1,now())");
  await expect(
    db.query(
      "select prepare_numbered_sponsorship($1,'a','Club','','Sports event',$2::jsonb,'issuer','SP-B',1,4)",
      [id, JSON.stringify([{ productId: product, quantity: 1 }])],
    ),
  ).rejects.toThrow(/BRANCH/);
  expect((await db.query("select * from sponsorship_issues")).rows).toEqual([]);
});
