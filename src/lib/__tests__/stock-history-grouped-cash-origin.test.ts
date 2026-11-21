import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const id = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
const [operation, installation, terminal, database, epoch, sale, movement, product, effect, person, key] =
  Array.from({ length: 11 }, (_, n) => id(n + 1));
const branch = "cash-fixture", project = "https://project.fixture", checkout = "a".repeat(64);
const accepted = { sale_id: sale, scope_id: branch, epoch, seq: "1", operation_id: operation, terminal_id: terminal,
  installation_generation: installation, database_guid: database, checkout_sha256: checkout, author_id: person, author_key_id: key };
const payload = { terminal_id: terminal, scope_id: branch, database_guid: database, epoch, checkout_sha256: checkout,
  author: { author_id: person, author_key_id: key, subject: "cashier", project_origin: project } };
const archivedAcceptance = { terminal_id: terminal, installation_generation: installation, database_guid: database, checkout_sha256: checkout };
const archive = [
  { table_name: "sales", row_data: { id: sale, store_id: branch, branch_id: branch, bill_number: "owned" } },
  { table_name: "sale_items", row_data: { sale_id: sale, branch_id: branch, product_id: product, is_return: false, quantity: 2 } },
  { table_name: "payment_transactions", row_data: { store_id: branch } },
  { table_name: "item_activity_logs", row_data: { id: movement, product_id: product, store_id: branch, terminal_id: terminal,
    activity_type: "sale", reference: "owned", quantity_delta: -2 } },
];
const fixture = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA private; CREATE SCHEMA pos_sync_feed_v1; CREATE SCHEMA pos_sync_private;
CREATE FUNCTION private.stock_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'IMMUTABLE'; END $$;
CREATE FUNCTION private.stock_history_record_source_verification(jsonb,text,text,text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN END $$;
CREATE FUNCTION private.stock_history_sale_source_origin(text,uuid,uuid,text,text,uuid,uuid[]) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE TABLE private.stock_history_accepted_effects(id uuid PRIMARY KEY,transaction_id bigint,product_id uuid,store_id text,quantity_delta numeric);
CREATE TABLE private.stock_history_source_receipts(movement_id uuid PRIMARY KEY,transaction_id bigint,product_id uuid,store_id text,quantity_delta numeric);
CREATE TABLE private.stock_history_effect_sources(effect_id uuid PRIMARY KEY,movement_id uuid UNIQUE);
CREATE TABLE pos_sync_feed_v1.cash_publications(organization_id text,scope_id text,epoch uuid,seq bigint,operation_id uuid,changes jsonb,acceptance jsonb);
CREATE TABLE pos_sync_private.shift_author_keys(key_id uuid PRIMARY KEY,author_id uuid,terminal_id text,project_origin text,subject text);
CREATE FUNCTION public.pos_stock_history_accept_claims(p_project text,p_branch text,p_terminal text,p_rows jsonb) RETURNS jsonb LANGUAGE plpgsql AS $claim$
DECLARE proof jsonb; operation uuid; author uuid; product uuid; effects uuid[]; registered record;
BEGIN
 SELECT * INTO registered FROM pos_sync_private.shift_author_keys WHERE project_origin=p_project;
 SELECT p_rows->'proof',(p_rows->>'operation')::uuid,(p_rows->>'author')::uuid,(p_rows->>'product')::uuid,
  ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(p_rows->'effects')) INTO proof,operation,author,product,effects;
 IF proof->>'action'='SALE' AND NOT private.stock_history_sale_source_origin(p_project,operation,author,p_branch,p_terminal,product,effects)
 THEN RAISE EXCEPTION 'STOCK_HISTORY_SOURCE_ORIGIN_UNPROVEN'; END IF;
 RETURN jsonb_build_object('ok',true);
END $claim$;`;

let db: PGlite;
beforeEach(async () => {
  db = new PGlite();
  await db.exec(fixture);
  await db.exec(readFileSync("scripts/preparation/pos-sync-inbox-v1.sql", "utf8"));
  await db.exec(readFileSync("scripts/preparation/pos-stock-history-grouped-cash-origin-v1.sql", "utf8"));
  await db.query("INSERT INTO pos_sync_private.shift_author_keys VALUES($1,$2,$3,$4,'cashier')", [key, person, terminal, project]);
});
afterEach(async () => { await db.close(); });

const count = async () => (await db.query<{ n: number }>(
  "SELECT count(*)::integer AS n FROM private.stock_history_grouped_cash_witnesses",
)).rows[0]!.n;
const claim = async () => (await db.query<{ value: { status: string } }>(
  "SELECT pos_sync_inbox_v1.claim_operation('default',$1,$2,$3) AS value", [operation, installation, payload],
)).rows[0]!.value;
const disposition = (status: string, result: object) =>
  db.query("SELECT pos_sync_inbox_v1.record_disposition('default',$1,$2,$3)", [operation, status, result]);
async function apply(result: object = accepted) {
  expect(await claim()).toEqual({ status: "PROCEED" });
  await db.query("INSERT INTO private.stock_history_accepted_effects VALUES($1,txid_current(),$2,$3,-2)", [effect, product, branch]);
  await db.query("INSERT INTO private.stock_history_source_receipts VALUES($1,txid_current(),$2,$3,-2)", [movement, product, branch]);
  await db.query("INSERT INTO private.stock_history_effect_sources VALUES($1,$2)", [effect, movement]);
  await disposition("APPLIED", result);
  await db.query("INSERT INTO pos_sync_feed_v1.cash_publications VALUES('default',$1,$2,1,$3,$4,$5)",
    [branch, epoch, operation, JSON.stringify(archive), archivedAcceptance]);
}
const matches = async (values: unknown[] = [project, operation, person, key, branch, terminal, product, [effect]]) =>
  (await db.query<{ matched: boolean }>("SELECT private.stock_history_grouped_cash_source_origin($1,$2,$3,$4,$5,$6,$7,$8) AS matched", values)).rows[0]!.matched;

describe("private grouped cash stock-history origin", () => {
  it("retains the APPLIED transaction and existing exact ACK across replay", async () => {
    await db.exec("BEGIN"); await apply(); await db.exec("COMMIT");
    expect(await matches()).toBe(true);
    expect(await claim()).toEqual({ status: "ALREADY_APPLIED", result: accepted });
    expect(await count()).toBe(1);
    expect((await db.query("SELECT disposition,claim_xid::text,result FROM pos_sync_inbox_v1.operation_receipts")).rows)
      .toEqual([{ disposition: "APPLIED", claim_xid: null, result: accepted }]);
    const submitted = { proof: { action: "SALE" }, operation, author: person, product, effects: [effect] };
    expect((await db.query("SELECT public.pos_stock_history_accept_claims($1,$2,$3,$4) AS value", [project, branch, terminal, submitted])).rows)
      .toEqual([{ value: { ok: true } }]);
  });

  it("uses the actual accepted transaction after a WAITING retry and rolls back abandoned witnesses", async () => {
    await db.exec("BEGIN"); expect(await claim()).toEqual({ status: "PROCEED" });
    await disposition("WAITING_DEPENDENCY", { reason: "SHIFT_MISSING" }); await db.exec("COMMIT");
    expect(await count()).toBe(0); expect(await matches()).toBe(false);
    await db.exec("BEGIN"); await apply(); expect(await count()).toBe(1); await db.exec("ROLLBACK");
    expect(await count()).toBe(0); expect(await matches()).toBe(false);
    await db.exec("BEGIN"); await apply(); await db.exec("COMMIT");
    expect(await matches()).toBe(true);
  });

  it("refuses another project, terminal, branch, actor, author key, operation, or product", async () => {
    await db.exec("BEGIN"); await apply(); await db.exec("COMMIT");
    const valid = [project, operation, person, key, branch, terminal, product, [effect]];
    for (const [index, replacement] of ["https://other.fixture", id(12), id(12), id(12), "other", id(12), id(12), [effect, id(12)]].entries()) {
      const substituted = [...valid]; substituted[index] = replacement;
      expect(await matches(substituted)).toBe(false);
    }
  });

  it("requires the archived original movement and a stock effect from the same accepted transaction", async () => {
    await db.exec("BEGIN"); await apply(); await db.exec("COMMIT");
    await db.query("UPDATE private.stock_history_accepted_effects SET transaction_id=transaction_id+1");
    await db.query("UPDATE private.stock_history_source_receipts SET transaction_id=transaction_id+1");
    expect(await matches()).toBe(false);
    await db.query("UPDATE private.stock_history_accepted_effects SET transaction_id=transaction_id-1");
    await db.query("UPDATE private.stock_history_source_receipts SET transaction_id=transaction_id-1");
    expect(await matches()).toBe(true);
    await db.query("UPDATE pos_sync_feed_v1.cash_publications SET changes=jsonb_set(changes,'{3,row_data,id}',to_jsonb($1::text))", [id(12)]);
    expect(await matches()).toBe(false);
  });

  it("binds the redacted archive to the subject inside the original inbox payload hash", async () => {
    await db.exec("BEGIN"); await apply(); await db.exec("COMMIT");
    expect(await matches()).toBe(true);
    await db.query("UPDATE pos_sync_private.shift_author_keys SET subject='another-cashier'");
    expect(await matches()).toBe(false);
  });

  it("holds unsigned checkout and preserves the ACK when optional witness storage rejects the insert", async () => {
    await db.exec("BEGIN"); await apply({ ...accepted, author_id: undefined });
    expect(await count()).toBe(0); expect(await matches()).toBe(false); await db.exec("ROLLBACK");
    await db.exec("CREATE TRIGGER reject_optional_witness BEFORE INSERT ON private.stock_history_grouped_cash_witnesses FOR EACH ROW EXECUTE FUNCTION private.stock_history_immutable()");
    await db.exec("BEGIN"); await apply(); await db.exec("COMMIT");
    expect(await count()).toBe(0); expect(await matches()).toBe(false);
    expect(await claim()).toEqual({ status: "ALREADY_APPLIED", result: accepted });
  });

  it("keeps origin proof private to the server's admission routine", async () => {
    const query = "SELECT has_function_privilege($1,'private.stock_history_grouped_cash_source_origin(text,uuid,uuid,uuid,text,text,uuid,uuid[])','EXECUTE') AS may_execute";
    for (const role of ["anon", "authenticated", "service_role"]) {
      expect((await db.query(query, [role])).rows).toEqual([{ may_execute: false }]);
    }
  });
});
