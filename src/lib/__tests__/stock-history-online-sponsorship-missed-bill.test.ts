import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createActualStockWriter } = require("../../../scripts/lib/stock-actual-writer-fixture.cjs");
const read = (path: string) => readFileSync(path, "utf8");
const draft = read("scripts/preparation/stock-history-online-sponsorship-missed-bill.sql");
const writers = `SELECT oid::regprocedure::text AS signature,pg_get_functiondef(oid) AS definition,proacl::text AS acl
 FROM pg_proc WHERE oid IN('public.issue_sponsorship(uuid,text,text)'::regprocedure,'public.pos_admin_add_missed_bill(jsonb,text,text)'::regprocedure,
   'public.pos_live_financial_admin_add_missed_bill(uuid,jsonb,text)'::regprocedure) ORDER BY signature`;
let f: Awaited<ReturnType<typeof createActualStockWriter>>;

beforeAll(async () => {
  f = await createActualStockWriter();
  await f.db.exec(`
    ALTER TABLE stores ADD COLUMN IF NOT EXISTS archived_at timestamptz;
    ALTER TABLE authorization_requests ADD COLUMN action_key text, ADD COLUMN expires_at timestamptz, ADD COLUMN requested_by text,
     ADD COLUMN decided_by text, ADD COLUMN decided_by_name text, ADD COLUMN payload jsonb, ADD COLUMN requested_amount numeric,
     ADD COLUMN approved_amount numeric, ADD COLUMN updated_at timestamptz, ADD COLUMN decision_note text;
    CREATE TABLE authorization_log(request_id uuid,outcome text,authorized_by text,action_key text,mode_used text,requested_by text,authorizer_role text,store_id text,detail jsonb);
    CREATE TABLE authorization_actions(action_key text,mode text,is_enabled boolean,require_reason boolean,threshold numeric);
  `);
  for (const name of ["20261024120332_mandatory_sponsorship_stock_issues.sql", "20261024123525_sponsorship_line_discounts.sql", "20261024124905_sponsorship_direct_issue_and_numbering.sql"]) {
    await f.db.exec(read(`supabase/migrations/${name}`));
  }
  await f.db.query(`UPDATE public.app_users SET full_name='Authorized synthetic actor',permissions=COALESCE(permissions,'{}')||
    '{"can_create_sponsorship":true,"can_issue_sponsorship":true}'::jsonb WHERE id=$1`, [f.author]);
  await f.db.query("UPDATE public.app_users SET permissions='{\"can_approve_sponsorship\":true}'::jsonb WHERE id=$1", [f.manager]);
  const original = (await f.db.query(writers)).rows;
  await f.db.exec(draft);
  expect((await f.db.query(writers)).rows).toEqual(original);
}, 30_000);
afterAll(async () => f?.db.close());
beforeEach(async () => {
  await f.db.query(`UPDATE public.products SET stock_by_store='{"A":10,"B":7}',stock_quantity=17,selling_price=10,cost_price=4,is_archived=false
    WHERE id=$1`, [f.product]);
  await f.db.exec("UPDATE public.sponsorship_direct_issue_policy SET user_ids='{}' WHERE id=1");
});

async function prepare(id: string, actor = f.author, quantity = 2) {
  return f.scalar("SELECT public.prepare_sponsorship($1,'A','Synthetic recipient','fixture contact','Test handover',$2::jsonb,$3)",
    [id, JSON.stringify([{ productId: f.product, quantity, discount: 0, discountType: "amount" }]), actor]);
}
async function issue(id: string, issuer = f.author) {
  return f.scalar("SELECT public.issue_sponsorship($1,$2,'Test receiver')", [id, issuer]);
}
async function prove(id: string) {
  return (await f.db.query(`SELECT w.*,e.accepted_at,w.transaction_id=e.transaction_id AS same_effect_transaction,
    w.transaction_id=r.transaction_id AS same_receipt_transaction,l.movement_id=w.receipt_id AS accepted_link
    FROM private.stock_history_online_deductions w JOIN private.stock_history_accepted_effects e ON e.id=w.effect_id
    JOIN private.stock_history_source_receipts r ON r.movement_id=w.receipt_id
    LEFT JOIN private.stock_history_effect_sources l ON l.effect_id=e.id AND l.movement_id=r.movement_id
    WHERE w.document_id=$1 ORDER BY w.product_id`, [id])).rows;
}
function bill(mode: "deduct" | "already_corrected" = "deduct") {
  return { clientKey: randomUUID(), storeId: "A", occurredAt: "2020-01-01T00:00:00Z", cashierId: f.author,
    originalReference: "fixture-" + randomUUID(), reason: "Synthetic paper bill", stockHandling: mode, stockReason: "Synthetic stock handling",
    items: [{ productId: f.product, quantity: 2, unitPrice: 10, unitCost: 4, discountAmount: 0, taxAmount: 0 }],
    payments: [{ method: "cash", amount: 20 }] };
}
const save = (value: ReturnType<typeof bill>, financial = false, terminal: string | null = null) =>
  financial ? f.scalar("SELECT public.pos_live_financial_admin_add_missed_bill($1,$2::jsonb,$3)", [f.admin, JSON.stringify(value), terminal])
    : f.scalar("SELECT public.pos_admin_add_missed_bill($1::jsonb,$2,$3)", [JSON.stringify(value), f.admin, terminal]);

describe("accepted online stock deductions", () => {
  it.each(["direct", "approval"] as const)("binds a real %s sponsorship once, retaining the actual branch and issuer", async mode => {
    const doc = randomUUID();
    await prepare(doc);
    const issuer = f.author;
    expect(await prove(doc)).toEqual([]);
    if (mode === "direct") {
      await f.db.query("UPDATE public.sponsorship_direct_issue_policy SET user_ids=ARRAY[$1::text] WHERE id=1", [issuer]);
    } else {
      await expect(issue(doc)).rejects.toThrow(/valid, separate full approval/);
      expect(await prove(doc)).toEqual([]);
      await f.db.query(`INSERT INTO public.authorization_requests(id,store_id,status,action_key,expires_at,requested_by,decided_by,decided_by_name,payload,requested_amount,approved_amount)
        SELECT id,store_id,'approved','sponsorship',now()+interval '1 hour',created_by,$2,'Test approver',
         jsonb_build_object('sponsorship_id',id,'document_hash',document_hash),total_value,total_value FROM public.sponsorship_issues WHERE id=$1`, [doc, f.manager]);
      await f.db.query("INSERT INTO public.authorization_log(request_id,outcome,authorized_by) VALUES($1,'requested',NULL),($1,'approved',$2)", [doc, f.manager]);
    }
    const output = await issue(doc, issuer);
    expect(output).toMatchObject({ status: "issued", authorization_mode: mode, given_by: issuer });
    expect(await issue(doc, issuer)).toEqual(output);
    expect(await f.stock()).toBe("8");
    expect(await prove(doc)).toMatchObject([{ action: "SPONSORSHIP_ISSUE", actor_id: issuer, store_id: "A", terminal_id: null,
      quantity_delta: "-2", same_effect_transaction: true, same_receipt_transaction: true, accepted_link: true }]);
  });

  it.each([false, true])("retains actual deduction time and the no-drawer contract with financial adapter %s", async financial => {
    const entry = bill();
    const terminal = financial ? f.terminal : null;
    const result = await save(entry, financial, terminal);
    expect(await save(entry, financial, terminal)).toEqual(result);
    expect(await f.stock()).toBe("8");
    expect(await prove(entry.clientKey)).toMatchObject([{ action: "MISSED_BILL", actor_id: f.admin, terminal_id: terminal,
      quantity_delta: "-2", same_effect_transaction: true, same_receipt_transaction: true, accepted_link: true }]);
    expect(await f.scalar(`SELECT w.stock_observed_at=e.accepted_at AND w.stock_observed_at>s.created_at AND s.shift_id IS NULL
      FROM private.stock_history_online_deductions w JOIN private.stock_history_accepted_effects e ON e.id=w.effect_id
      JOIN public.sales s ON s.id=w.document_id WHERE w.document_id=$1`, [entry.clientKey])).toBe(true);
    expect(await f.scalar("SELECT shift_id FROM public.payment_transactions WHERE sale_id=$1", [entry.clientKey])).toBeNull();
  });

  it("keeps the already-corrected path financial-only", async () => {
    const entry = bill("already_corrected");
    await save(entry);
    expect(await f.stock()).toBe("10");
    expect(await prove(entry.clientKey)).toEqual([]);
  });

  it("cannot re-label a prior stock receipt as a new issue", async () => {
    const doc = randomUUID();
    await prepare(doc, f.admin);
    await f.db.query("SELECT public.stock_apply_delta(md5('sponsorship:'||$1::text||':'||$2::uuid::text)::uuid,$2::uuid,'A',-2)", [doc, f.product]);
    expect(await f.stock()).toBe("8");
    await issue(doc, f.admin);
    expect(await f.stock()).toBe("8");
    expect(await prove(doc)).toEqual([]);
  });

  it("does not partially witness a missed bill with a second, unbound product effect", async () => {
    const entry = bill();
    const unrelated = randomUUID();
    await f.db.query("INSERT INTO public.products(id,barcode,name,owner_store_id,stock_by_store,stock_quantity) VALUES($1::uuid,$1::uuid::text,'Second synthetic product','A','{\"A\":6}',6)", [unrelated]);
    const twoLines = { ...entry, items: [...entry.items, { ...entry.items[0]!, productId: unrelated }], payments: [{ method: "cash", amount: 40 }] };
    await f.db.query("SELECT public.stock_apply_delta(md5($1::text||':stock:'||$2::uuid::text)::uuid,$2::uuid,'A',-2)", [entry.clientKey, unrelated]);
    const saved = await save(twoLines);
    expect(saved.items).toHaveLength(2);
    expect(await f.stock()).toBe("8");
    expect(await prove(entry.clientKey)).toEqual([]);
  });

  it("keeps evidence and business deductions atomic when the caller rolls back", async () => {
    const entry = bill();
    await f.db.exec("BEGIN");
    try {
      await save(entry);
      expect(await prove(entry.clientKey)).toHaveLength(1);
      expect(await f.stock()).toBe("8");
    } finally {
      await f.db.exec("ROLLBACK");
    }
    expect(await prove(entry.clientKey)).toEqual([]);
    expect(await f.stock()).toBe("10");
  });

  it("leaves a valid business save and its unresolved stock effect intact when optional evidence cannot persist", async () => {
    const entry = bill();
    await f.db.exec(`CREATE FUNCTION private.fixture_fail_optional_stock_proof() RETURNS trigger LANGUAGE plpgsql AS $f$
      BEGIN RAISE EXCEPTION 'Synthetic optional evidence failure'; END $f$;
      CREATE TRIGGER fixture_fail_optional_stock_proof BEFORE INSERT ON private.stock_history_online_deductions FOR EACH ROW
       EXECUTE FUNCTION private.fixture_fail_optional_stock_proof();`);
    try {
      const saved = await save(entry);
      expect(saved).toMatchObject({ saleId: entry.clientKey, receiptNo: `MB-${entry.clientKey}` });
      expect(await f.stock()).toBe("8");
      expect(await prove(entry.clientKey)).toEqual([]);
      expect(await f.scalar(`SELECT count(*)::int FROM private.stock_history_source_receipts
        WHERE movement_id=md5($1::text||':stock:'||$2::text)::uuid`, [entry.clientKey, f.product])).toBe(1);
    } finally {
      await f.db.exec(`DROP TRIGGER fixture_fail_optional_stock_proof ON private.stock_history_online_deductions;
        DROP FUNCTION private.fixture_fail_optional_stock_proof();`);
    }
  });

  it("keeps report evidence private, immutable, and separate from accepted ledger coverage", async () => {
    for (const role of ["anon", "authenticated", "service_role"]) {
      expect(await f.scalar("SELECT has_table_privilege($1,'private.stock_history_online_deductions','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')", [role])).toBe(false);
    }
    await expect(f.db.exec("UPDATE private.stock_history_online_deductions SET quantity_delta=-9")).rejects.toThrow(/IMMUTABLE/);
    expect(await f.scalar("SELECT count(*)::int FROM public.stock_history_movements")).toBe(0);
    expect(await f.scalar("SELECT count(*)::int FROM private.stock_history_effect_coverage")).toBe(0);
  });
});
