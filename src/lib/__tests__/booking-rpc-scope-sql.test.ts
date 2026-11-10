import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";

const schema = readFileSync("supabase/schema.sql", "utf8").replaceAll("\r\n", "\n");
const preparation = readFileSync("scripts/preparation/pos-booking-rpc-scope-v1.sql", "utf8");
const handoverPreparation = readFileSync("scripts/preparation/pos-booking-handover-v1.sql", "utf8");
const routines = ["booking_net_paid", "booking_balance_state", "booking_collect", "booking_refund", "booking_cancel"];
const signatures = [
  "booking_net_paid(uuid)", "booking_balance_state(uuid)",
  "booking_collect(uuid,numeric,text,text,text,text,boolean)",
  "booking_refund(uuid,numeric,text,text,text,text)", "booking_cancel(uuid,text,text,text,text,text)",
].map(name => "public." + name).join(", ");

function definition(name: string) {
  const start = schema.lastIndexOf("CREATE OR REPLACE FUNCTION public." + name + "(");
  const source = schema.slice(start);
  const delimiter = source.match(/\bAS\s+(\$\w*\$)/i)?.[1];
  if (start < 0 || !delimiter) throw new Error("Missing canonical routine " + name);
  return source.slice(0, source.indexOf(delimiter + ";", source.indexOf(delimiter) + delimiter.length) + delimiter.length + 1);
}

function policy(name: string) {
  const start = schema.lastIndexOf('CREATE POLICY "' + name + '"');
  if (start < 0) throw new Error("Missing canonical policy " + name);
  return schema.slice(start, schema.indexOf(";", start) + 1);
}

function tableDefinition(name: string) {
  const start = schema.indexOf("CREATE TABLE IF NOT EXISTS public." + name + " (");
  if (start < 0) throw new Error("Missing canonical table " + name);
  return schema.slice(start, schema.indexOf("\n);", start) + 3);
}

it("keeps all booking money RPCs within the table's branch and authorization rules", async () => {
  const db = new PGlite();
  const staff = randomUUID(), manager = randomUUID(), denied = randomUUID();
  const local = randomUUID(), foreign = randomUUID();
  const actor = async (user: string | null, role = "authenticated") => {
    await db.exec("RESET ROLE");
    await db.query("SELECT set_config('test.uid',$1,false), set_config('test.role',$2,false)", [user ?? "", role]);
    if (role === "service_role") await db.exec("SET ROLE service_role");
    else await db.exec("SET ROLE authenticated");
  };
  const collect = (id: string, amount: number, key = randomUUID(), complete = false) =>
    db.query("SELECT * FROM public.booking_collect($1,$2,'cash','Fixture cashier',NULL,$3,$4)", [id, amount, key, complete]);
  const refund = (id: string) =>
    db.query("SELECT * FROM public.booking_refund($1,1,'cash','Fixture refund','Fixture cashier',$2)", [id, randomUUID()]);
  const cancel = (id: string) =>
    db.query("SELECT (public.booking_cancel($1,'Fixture cancellation','Fixture cashier',NULL,'retained',$2)).status AS status", [id, randomUUID()]);
  const balance = (id: string) => db.query("SELECT * FROM public.booking_balance_state($1)", [id]);
  const paid = (id: string) => db.query("SELECT public.booking_net_paid($1)::float8 AS paid", [id]);
  const rpcMetadata = () => db.query<{ oid: string; proacl: string; prosecdef: boolean }>(`
    SELECT p.oid::text, p.proacl::text, p.prosecdef
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname=ANY($1::text[]) ORDER BY p.proname`, [routines]);

  try {
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE SCHEMA auth; CREATE SCHEMA extensions; CREATE SCHEMA private;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
        SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
      CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
        SELECT nullif(current_setting('test.role',true),'') $$;
      CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{}'::jsonb $$;
      GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;
      CREATE TABLE public.user_roles(user_id uuid NOT NULL, role text NOT NULL);
      CREATE TABLE public.app_users(auth_user_id uuid, role text, role_slug text, email text, is_active boolean,
        store_id text, permissions jsonb);
      CREATE TABLE public.bookings(id uuid PRIMARY KEY, store_id text NOT NULL, total numeric NOT NULL,
        paid numeric NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'active', job_status text,
        member_id uuid, sale_receipt_no text, row_version integer NOT NULL DEFAULT 1,
        job_status_at timestamptz, job_status_by text, cashier text, closed_at timestamptz,
        cancel_reason text, cancelled_by text, cancelled_at timestamptz, cancelled_terminal text, cancel_money_action text);
      CREATE TABLE public.booking_payments(id uuid PRIMARY KEY, booking_id uuid REFERENCES public.bookings(id),
        amount numeric NOT NULL, method text, cashier text, paid_at timestamptz, status text,
        reference text, client_payment_id text, kind text, change_given numeric, refund_reason text,
        created_at timestamptz, row_version integer DEFAULT 1, reversed_at timestamptz, reversed_by text, refunds_payment_id uuid);
      CREATE UNIQUE INDEX booking_payment_once ON public.booking_payments(booking_id,client_payment_id);
      ${["sales", "sale_items", "payment_transactions", "item_activity_logs", "members"].map(tableDefinition).join("\n")}
      ALTER TABLE public.sales ADD PRIMARY KEY(id), ADD UNIQUE(bill_number), ADD UNIQUE(client_transaction_id);
      ALTER TABLE public.sale_items ADD PRIMARY KEY(id);
      ALTER TABLE public.payment_transactions ADD PRIMARY KEY(id);
      ALTER TABLE public.item_activity_logs ADD PRIMARY KEY(id);
      ALTER TABLE public.members ADD PRIMARY KEY(id);
      CREATE FUNCTION public.stock_apply_deltas(jsonb) RETURNS TABLE(status text, reason text)
        LANGUAGE sql AS $$ SELECT 'applied'::text, NULL::text $$;
      CREATE FUNCTION public.test_reject_fixture_sale() RETURNS trigger LANGUAGE plpgsql AS $sale$
      BEGIN
        IF NEW.bill_number = 'REFUSED' THEN RAISE EXCEPTION 'Fixture sale refused'; END IF;
        RETURN NEW;
      END;
      $sale$;
      CREATE TRIGGER test_reject_fixture_sale BEFORE INSERT ON public.sales
        FOR EACH ROW EXECUTE FUNCTION public.test_reject_fixture_sale();
      ${["is_app_supervisor", "is_staff", "is_staff_now", "is_supervisor_now", "user_store_id",
        "store_visible", "user_has_store_access", "has_perm", ...routines,
        "booking_payment_within_total", "bookings_block_unpaid_collection", "bump_row_version",
        "pos_sale_commit", "pos_sync_push_aggregate", "sync_apply_booking_payments"].map(definition).join("\n")}
      CREATE TABLE public.sync_idempotency_receipts(batch_id uuid PRIMARY KEY, organization_id text,
        branch_id text, table_name text, payload_hash text, applied_count integer);
      CREATE FUNCTION public.pos_sync_validate_scope(text,text,text) RETURNS void LANGUAGE plpgsql AS $scope$
      BEGIN
        IF auth.role() IS DISTINCT FROM 'service_role' OR $2 IS DISTINCT FROM 'a' OR $3 IS DISTINCT FROM 'fixture-terminal'
          THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF;
      END $scope$;
      CREATE FUNCTION public.sync_apply_bookings(rows jsonb) RETURNS integer LANGUAGE plpgsql AS $booking$
      DECLARE changed integer;
      BEGIN
        UPDATE public.bookings b SET paid=(x->>'paid')::numeric,status=x->>'status',sale_receipt_no=x->>'sale_receipt_no'
          FROM jsonb_array_elements(rows) x WHERE b.id=(x->>'id')::uuid AND b.row_version < (x->>'row_version')::integer;
        GET DIAGNOSTICS changed=ROW_COUNT; RETURN changed;
      END $booking$;
      CREATE FUNCTION public.sync_apply_sales(rows jsonb) RETURNS integer LANGUAGE plpgsql AS $sale$
      BEGIN PERFORM public.pos_sale_commit(rows->0); RETURN 1; END $sale$;
      CREATE FUNCTION public.sync_delete_bookings(jsonb,text,text) RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
      CREATE FUNCTION public.sync_delete_booking_payments(jsonb,text,text) RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
      CREATE FUNCTION public.sync_delete_sales(jsonb,text,text) RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
      REVOKE ALL ON FUNCTION public.pos_sync_push_aggregate(uuid,text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
      GRANT EXECUTE ON FUNCTION public.pos_sync_push_aggregate(uuid,text,text,text,jsonb) TO service_role;
      CREATE TRIGGER booking_within_total BEFORE INSERT ON public.booking_payments
        FOR EACH ROW EXECUTE FUNCTION public.booking_payment_within_total();
      CREATE TRIGGER booking_settled BEFORE UPDATE ON public.bookings
        FOR EACH ROW EXECUTE FUNCTION public.bookings_block_unpaid_collection();
      CREATE TRIGGER booking_version BEFORE UPDATE ON public.bookings
        FOR EACH ROW EXECUTE FUNCTION public.bump_row_version();
      ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.booking_payments ENABLE ROW LEVEL SECURITY;
      ${policy("Branch staff read bookings")}
      ${policy("Branch staff update bookings")}
      ${policy("Branch staff read booking payments")}
      GRANT SELECT ON public.bookings,public.booking_payments TO authenticated,service_role;
      GRANT UPDATE ON public.bookings TO authenticated;
      GRANT SELECT, INSERT, UPDATE ON public.sales,public.sale_items,public.payment_transactions,public.item_activity_logs,public.members TO authenticated;
      REVOKE ALL ON FUNCTION ${signatures} FROM PUBLIC,anon;
      GRANT EXECUTE ON FUNCTION ${signatures} TO authenticated,service_role;
    `);
    const original = await rpcMetadata();
    await db.exec("ALTER FUNCTION public.booking_refund(uuid,numeric,text,text,text,text) COST 101");
    await expect(db.exec(preparation)).rejects.toThrow(/POS_BOOKING_SCOPE_SOURCE_UNEXPECTED.*booking_refund/);
    await db.exec("ROLLBACK; ALTER FUNCTION public.booking_refund(uuid,numeric,text,text,text,text) COST 100;");
    expect((await rpcMetadata()).rows).toEqual(original.rows);

    await db.exec(preparation);
    const secured = await rpcMetadata();
    expect(secured.rows.map(({ oid, proacl }) => ({ oid, proacl })))
      .toEqual(original.rows.map(({ oid, proacl }) => ({ oid, proacl })));
    expect(secured.rows.filter(row => row.prosecdef).length).toBe(3);

    const bookingPermissions = JSON.stringify({ can_collect_booking: true, can_cancel_booking: true, can_process_refund: true, can_process_sale: true });
    await db.query(`INSERT INTO public.app_users(auth_user_id,role,is_active,store_id,permissions) VALUES
      ($1,'staff',true,'a',$4),($2,'manager',true,'a',$4),($3,'staff',true,'a','{}');`,
    [staff, manager, denied, bookingPermissions]);
    await db.query("INSERT INTO public.bookings(id,store_id,total) VALUES($1,'a',25),($2,'b',25)", [local, foreign]);

    await actor(staff);
    expect((await balance(local)).rows).toHaveLength(1);
    const key = randomUUID();
    expect((await collect(local, 10, key)).rows[0]).toMatchObject({ duplicate: false });
    expect((await collect(local, 10, key)).rows[0]).toMatchObject({ duplicate: true });
    expect((await collect(local, 20, randomUUID(), true)).rows[0]).toMatchObject({ status: "collected" });
    expect((await paid(local)).rows[0]).toEqual({ paid: 25 });
    expect((await balance(foreign)).rows).toEqual([]);
    expect((await paid(foreign)).rows[0]).toEqual({ paid: 0 });
    await expect(collect(foreign, 5)).rejects.toThrow(/BOOKING_NOT_FOUND/);
    await expect(refund(foreign)).rejects.toThrow(/BOOKING_NOT_FOUND/);
    await expect(cancel(foreign)).rejects.toThrow(/BOOKING_NOT_FOUND/);

    await actor(denied);
    await expect(collect(local, 1)).rejects.toThrow(/PERMISSION_DENIED_COLLECT_BOOKING/);

    await actor(null, "service_role");
    expect((await collect(foreign, 3)).rows).toHaveLength(1);
    expect((await paid(foreign)).rows[0]).toEqual({ paid: 3 });

    await actor(manager);
    expect((await balance(foreign)).rows).toHaveLength(1);
    expect((await collect(foreign, 4)).rows).toHaveLength(1);
    expect((await refund(foreign)).rows).toHaveLength(1);
    expect((await cancel(foreign)).rows[0]).toEqual({ status: "cancelled" });
    expect((await paid(foreign)).rows[0]).toEqual({ paid: 6 });

    await actor(staff);
    expect((await paid(foreign)).rows[0]).toEqual({ paid: 0 });
    const handoverBooking = randomUUID(), handoverSale = randomUUID(), nativeBooking = randomUUID();
    await db.exec("RESET ROLE");
    await db.query("INSERT INTO public.bookings(id,store_id,total) VALUES($1,'a',25),($2,'a',25)", [handoverBooking, nativeBooking]);
    await actor(staff);
    await collect(nativeBooking, 5);
    const nativeGraph = (bill: string, version = 3) => {
      const sale = randomUUID();
      return [
        { table: "sales", rows: [{ id: sale, store_id: "a", client_transaction_id: sale, bill_number: bill,
          total_amount: 25, paid_amount: 25, payment_type: "cash" }] },
        { table: "bookings", rows: [{ id: nativeBooking, store_id: "a", total: 25, paid: 25, status: "collected",
          sale_receipt_no: bill, row_version: version }] },
        { table: "booking_payments", rows: [{ id: randomUUID(), booking_id: nativeBooking, amount: 20,
          method: "cash", status: "settled", kind: "payment", client_payment_id: sale }] },
      ];
    };
    const push = (graph: unknown, key = randomUUID()) => db.query<{ receipt: unknown }>(`
      SELECT public.pos_sync_push_aggregate($1,'default','a','fixture-terminal',$2::jsonb) AS receipt`,
    [key, JSON.stringify(graph)]);
    await actor(null, "service_role");
    await expect(push(nativeGraph("NATIVE-BEFORE-PREP"))).rejects.toThrow(/BOOKING_BALANCE_DUE/);
    await db.exec("RESET ROLE");
    await db.exec(handoverPreparation);
    await actor(null, "service_role");
    await expect(push(nativeGraph("NATIVE-STALE", 4))).rejects.toThrow(/BOOKING_HANDOVER_UPLOAD_CONFLICT/);
    await expect(push(nativeGraph("REFUSED"))).rejects.toThrow(/Fixture sale refused/);
    expect((await balance(nativeBooking)).rows[0]).toMatchObject({ status: "active", settled_paid: "5.00" });
    const nativeBatch = nativeGraph("NATIVE-AFTER-PREP"), batchId = randomUUID();
    expect((await push(nativeBatch, batchId)).rows[0].receipt).toMatchObject({ ok: true });
    expect((await push(nativeBatch, batchId)).rows[0].receipt).toMatchObject({ ok: true, replayed: true });
    expect((await balance(nativeBooking)).rows[0]).toMatchObject({ status: "collected", settled_paid: "25.00" });
    // A different CT batch containing the same already acknowledged tender
    // reaches the before-insert balance guard before ON CONFLICT can help.
    await expect(push(nativeBatch.slice(1))).rejects.toThrow(/exceeds the amount still due/);
    await expect(push(nativeGraph("NATIVE-SECOND-SALE"))).rejects.toThrow(/BOOKING_HANDOVER_UPLOAD_CONFLICT/);
    const handover = (bill: string, amount: number, id = handoverBooking, saleId = handoverSale) =>
      db.query<{ receipt: unknown }>(`SELECT public.booking_handover(
        $1,$2,jsonb_build_object('id',$3::text,'client_transaction_id',$3::text,'bill_number',$4::text,
        'store_id','a','total_amount',25,'paid_amount',25,'payment_type','cash'),'[]','[]','[]',NULL) AS receipt`,
      [id, amount, saleId, bill]);
    await actor(staff);
    await collect(handoverBooking, 5);
    await expect(handover("BOOKING-1", 19)).rejects.toThrow(/BOOKING_BALANCE_DUE/);
    await expect(handover("REFUSED", 20)).rejects.toThrow(/Fixture sale refused/);
    expect((await balance(handoverBooking)).rows[0]).toMatchObject({ status: "active", settled_paid: "5.00" });
    expect((await db.query("SELECT bill_number FROM public.sales")).rows).toEqual([{ bill_number: "NATIVE-AFTER-PREP" }]);
    await expect(handover("BOOKING-1", 25, foreign)).rejects.toThrow(/BOOKING_NOT_FOUND/);
    const saved = (await handover("BOOKING-1", 25)).rows[0].receipt;
    expect(saved).toMatchObject({
      sale_id: handoverSale, sale_receipt_no: "BOOKING-1", paid: 25, change: 5, replayed: false,
      payment: { amount: 20, client_payment_id: handoverSale },
    });
    expect((await handover("UNUSED-RETRY-NUMBER", 25)).rows[0].receipt).toMatchObject({
      ...saved as Record<string, unknown>, replayed: true,
      sale: { id: handoverSale, bill_number: "BOOKING-1", sale_items: [] },
    });
    await expect(handover("SECOND-RECEIPT", 25, handoverBooking, randomUUID())).rejects.toThrow(/BOOKING_ALREADY_COLLECTED/);
    expect((await db.query("SELECT bill_number FROM public.sales ORDER BY bill_number")).rows)
      .toEqual([{ bill_number: "BOOKING-1" }, { bill_number: "NATIVE-AFTER-PREP" }]);
    await db.exec("RESET ROLE; SET ROLE anon");
    await expect(balance(local)).rejects.toThrow(/permission denied/);
    await expect(handover("BOOKING-1", 25)).rejects.toThrow(/permission denied/);
  } finally {
    await db.close();
  }
});
