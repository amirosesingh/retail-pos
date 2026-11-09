import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";

const schema = readFileSync("supabase/schema.sql", "utf8").replaceAll("\r\n", "\n");
const preparation = readFileSync("scripts/preparation/pos-booking-rpc-scope-v1.sql", "utf8");
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
      CREATE SCHEMA auth; CREATE SCHEMA extensions;
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
        job_status_at timestamptz, job_status_by text, cashier text, closed_at timestamptz,
        cancel_reason text, cancelled_by text, cancelled_at timestamptz, cancelled_terminal text, cancel_money_action text);
      CREATE TABLE public.booking_payments(id uuid PRIMARY KEY, booking_id uuid REFERENCES public.bookings(id),
        amount numeric NOT NULL, method text, cashier text, paid_at timestamptz, status text,
        reference text, client_payment_id text, kind text, change_given numeric, refund_reason text);
      CREATE UNIQUE INDEX booking_payment_once ON public.booking_payments(booking_id,client_payment_id);
      ${["is_app_supervisor", "is_staff", "is_staff_now", "is_supervisor_now", "user_store_id",
        "store_visible", "user_has_store_access", "has_perm", ...routines,
        "booking_payment_within_total", "bookings_block_unpaid_collection"].map(definition).join("\n")}
      CREATE TRIGGER booking_within_total BEFORE INSERT ON public.booking_payments
        FOR EACH ROW EXECUTE FUNCTION public.booking_payment_within_total();
      CREATE TRIGGER booking_settled BEFORE UPDATE ON public.bookings
        FOR EACH ROW EXECUTE FUNCTION public.bookings_block_unpaid_collection();
      ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.booking_payments ENABLE ROW LEVEL SECURITY;
      ${policy("Branch staff read bookings")}
      ${policy("Branch staff read booking payments")}
      GRANT SELECT ON public.bookings,public.booking_payments TO authenticated,service_role;
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

    const bookingPermissions = JSON.stringify({ can_collect_booking: true, can_cancel_booking: true, can_process_refund: true });
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
    await db.exec("RESET ROLE; SET ROLE anon");
    await expect(balance(local)).rejects.toThrow(/permission denied/);
  } finally {
    await db.close();
  }
});
