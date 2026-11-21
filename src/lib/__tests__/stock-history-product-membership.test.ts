import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ledger = readFileSync("supabase/migrations/20261105113916_stock_history_effective_ledger.sql", "utf8");
const effects = readFileSync("supabase/migrations/20261105172030_stock_history_accepted_effect_capture.sql", "utf8");
const prepared = readFileSync("scripts/preparation/stock-history-product-membership.sql", "utf8");
let db: PGlite;
const uuid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const observe = async (branch: string, item: string, cutoff = "17952000001234567") => {
  const result = await db.query<{ evidence: Record<string, unknown> }>(
    "SELECT private.stock_history_product_membership_evidence($1,$2::uuid,$3::numeric) evidence", [branch, item, cutoff],
  );
  return result.rows[0]!.evidence;
};

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE public.stores(id text PRIMARY KEY,group_id text);
    INSERT INTO public.stores VALUES('A','one'),('B','two'),('B-peer','two');
    CREATE TABLE public.app_users(user_id text PRIMARY KEY,role text,role_slug text,store_id text,is_active boolean,permissions jsonb);
    CREATE TABLE public.terminal_tokens(id uuid PRIMARY KEY,location_id text,status text,revoked_at timestamptz,platform text,is_claimed boolean,management_sync_enabled boolean);
    CREATE TABLE public.products(id uuid PRIMARY KEY,name text NOT NULL,sku text,barcode text,owner_store_id text,stock_by_store jsonb DEFAULT '{}'::jsonb,
      stock_quantity integer NOT NULL DEFAULT 0,is_archived boolean NOT NULL DEFAULT false,row_version integer NOT NULL DEFAULT 1);
    CREATE TABLE public.stock_delta_applied(movement_id uuid PRIMARY KEY,product_id uuid,store_id text,delta integer);
    CREATE TABLE public.item_activity_logs(id uuid PRIMARY KEY,product_id uuid,store_id text,quantity_delta integer);
    CREATE TABLE public.stock_transfers(id uuid PRIMARY KEY,to_store_id text NOT NULL,status text NOT NULL,posted_at timestamptz,verified_at timestamptz,row_version integer NOT NULL DEFAULT 1);
    CREATE TABLE public.stock_transfer_items(id uuid PRIMARY KEY,transfer_id uuid NOT NULL REFERENCES public.stock_transfers(id) ON DELETE CASCADE,
      product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,quantity_verified integer,row_version integer NOT NULL DEFAULT 1);
    CREATE INDEX stock_transfer_items_transfer_idx ON public.stock_transfer_items(transfer_id);
    CREATE TABLE public.shifts(id uuid PRIMARY KEY,store_id text,status text,closed_at timestamptz);
    INSERT INTO public.products(id,name,sku,barcode,owner_store_id) VALUES('${uuid(1)}','Pre-existing','01','001','A');
  `);
  await db.exec(ledger);
  await db.exec(effects);
  await db.exec(prepared);
}, 30_000);
afterAll(async () => db?.close());

describe("recorded product membership evidence", () => {
  it("records no backfill and treats an existing current product as historically unknown", async () => {
    expect(await observe("A", uuid(1))).toMatchObject({ status: "unknown", membershipVerified: false, observations: [] });
  });

  it("retains independent zero birth and physical removal identity despite deleting the live row", async () => {
    const item = uuid(2);
    await db.exec(`INSERT INTO public.products(id,name,sku,barcode,owner_store_id,stock_by_store,stock_quantity)
      VALUES('${item}','Zero at birth','002','0002','A','{}',0);
      UPDATE public.products SET name='Last known name',is_archived=true,row_version=2 WHERE id='${item}';
      DELETE FROM public.products WHERE id='${item}';`);
    const evidence = await observe("A", item);
    expect(evidence).toMatchObject({ status: "recorded_unresolved", reason: "ORIGINAL_MEMBERSHIP_TIME_UNVERIFIED", membershipVerified: false,
      observations: [
        { kind: "product_deleted", sourceVersion: 2, identity: { name: "Last known name", sku: "002", barcode: "0002", ownerStoreId: "A" } },
        { kind: "product_created", sourceVersion: 1, identity: { name: "Zero at birth", sku: "002", barcode: "0002", ownerStoreId: "A" } },
      ],
    });
    expect(await observe("B", item)).toMatchObject({ status: "unknown", observations: [] });
    expect(await observe("a", item)).toMatchObject({ status: "unknown", observations: [] });
    expect((await db.query("SELECT count(*)::int n FROM public.stock_history_movements")).rows[0]).toEqual({ n: 0 });
    expect((await db.query("SELECT count(*)::int n FROM public.products WHERE id=$1::uuid", [item])).rows[0]).toEqual({ n: 0 });
  });

  it("keeps direct owner transitions separately and ignores quantity-only, archive, and same-owner writes", async () => {
    const item = uuid(3);
    await db.exec(`INSERT INTO public.products(id,name,barcode,owner_store_id,stock_by_store) VALUES('${item}','Owner A','03','A','{"A":0}');
      UPDATE public.products SET stock_by_store='{"A":2}',stock_quantity=2,is_archived=false WHERE id='${item}';
      UPDATE public.products SET owner_store_id='A',is_archived=true WHERE id='${item}';
      UPDATE public.products SET name='Moved to B',owner_store_id='B',row_version=2 WHERE id='${item}';`);
    expect(await observe("A", item)).toMatchObject({ membershipVerified: false,
      observations: [{ kind: "direct_owner_removed", identity: { name: "Owner A" } }, { kind: "product_created" }] });
    expect(await observe("B", item)).toMatchObject({ membershipVerified: false,
      observations: [{ kind: "direct_owner_added", identity: { name: "Moved to B", ownerStoreId: "B" } }] });
    expect(await observe("B-peer", item)).toMatchObject({ status: "unknown", observations: [] });
  });

  it("records the actual owner even when a before-trigger made the change", async () => {
    const item = uuid(31);
    await db.exec(`CREATE FUNCTION public.fixture_resolve_owner() RETURNS trigger LANGUAGE plpgsql AS $f$
      BEGIN IF NEW.name='Actual owner B' THEN NEW.owner_store_id='B'; END IF; RETURN NEW; END $f$;
      CREATE TRIGGER fixture_resolve_owner BEFORE UPDATE OF name ON public.products FOR EACH ROW EXECUTE FUNCTION public.fixture_resolve_owner();
      INSERT INTO public.products(id,name,barcode,owner_store_id) VALUES('${item}','Before owner change','031','A');
      UPDATE public.products SET name='Actual owner B' WHERE id='${item}';
      DROP TRIGGER fixture_resolve_owner ON public.products; DROP FUNCTION public.fixture_resolve_owner();`);
    expect(await observe("B", item)).toMatchObject({ observations: [{ kind: "direct_owner_added", identity: { name: "Actual owner B" } }] });
  });

  it("retains a positive verified inbound receipt for its destination while carrying no group scope or effective time", async () => {
    const item = uuid(4), transfer = uuid(41), line = uuid(42), zero = uuid(43);
    await db.exec(`INSERT INTO public.products(id,name,barcode,owner_store_id) VALUES('${item}','Original inbound','004','A');
      INSERT INTO public.stock_transfers(id,to_store_id,status) VALUES('${transfer}','B','received');
      INSERT INTO public.stock_transfer_items VALUES('${line}','${transfer}','${item}',3,2),('${zero}','${transfer}','${item}',0,1);`);
    expect(await observe("B", item)).toMatchObject({ status: "unknown", observations: [] });
    await db.exec(`UPDATE public.stock_transfers SET status='completed_with_discrepancy',posted_at='2020-01-01Z',verified_at='2020-01-01Z',row_version=3 WHERE id='${transfer}';
      UPDATE public.stock_transfer_items SET quantity_verified=3 WHERE id='${line}';
      UPDATE public.products SET name='Later rename' WHERE id='${item}';
      DELETE FROM public.products WHERE id='${item}';
      DELETE FROM public.stock_transfers WHERE id='${transfer}';`);
    const response = await observe("B", item, "1");
    expect(response).toMatchObject({ cutoffTicks: "1", membershipVerified: false, status: "recorded_unresolved",
      observations: [{ kind: "posted_inbound_seen", transferId: transfer, transferLineId: line, sourceVersion: 2, transferVersion: 3,
        identity: { name: "Original inbound", barcode: "004", ownerStoreId: "A" } }],
    });
    expect(await observe("B-peer", item)).toMatchObject({ status: "unknown", observations: [] });
  });

  it("records either accepted write order, while ignoring an absent canonical verified posting stamp", async () => {
    const item = uuid(5), transfer = uuid(51), line = uuid(52);
    await db.exec(`INSERT INTO public.products(id,name,barcode,owner_store_id) VALUES('${item}','Late verified line','005','A');
      INSERT INTO public.stock_transfers VALUES('${transfer}','B','completed','2020-01-01Z',NULL,1);
      INSERT INTO public.stock_transfer_items VALUES('${line}','${transfer}','${item}',0,1);`);
    expect(await observe("B", item)).toMatchObject({ status: "unknown" });
    await db.exec(`UPDATE public.stock_transfers SET verified_at=posted_at WHERE id='${transfer}';
      UPDATE public.stock_transfer_items SET quantity_verified=1,row_version=2 WHERE id='${line}';`);
    expect(await observe("B", item)).toMatchObject({ observations: [{ transferLineId: line, kind: "posted_inbound_seen" }] });
  });

  it("leaves an oversized receipt unresolved instead of partially publishing its lines", async () => {
    const item = uuid(51), transfer = uuid(510);
    await db.exec(`INSERT INTO public.products(id,name,barcode,owner_store_id) VALUES('${item}','Oversized receipt','051','A');
      INSERT INTO public.stock_transfers(id,to_store_id,status) VALUES('${transfer}','B','received');
      INSERT INTO public.stock_transfer_items(id,transfer_id,product_id,quantity_verified)
       SELECT gen_random_uuid(),'${transfer}','${item}',1 FROM generate_series(1,101);
      UPDATE public.stock_transfers SET status='completed',posted_at='2020-01-01Z',verified_at='2020-01-01Z' WHERE id='${transfer}';`);
    expect(await observe("B", item)).toMatchObject({ status: "unknown", membershipVerified: false, observations: [] });
  });

  it("does not infer an owner from the stock map or retain any rolled-back observation", async () => {
    await db.exec(`BEGIN; INSERT INTO public.products(id,name,barcode,owner_store_id) VALUES('${uuid(6)}','Roll back','06','A'); ROLLBACK;
      INSERT INTO public.products(id,name,barcode,stock_by_store) VALUES('${uuid(7)}','Unscoped zero','07','{"A":0}');`);
    expect(await observe("A", uuid(6))).toMatchObject({ status: "unknown", observations: [] });
    expect(await observe("A", uuid(7))).toMatchObject({ status: "unknown", observations: [] });
    const privateRows = await db.query("SELECT store_id,event_kind FROM private.stock_history_product_membership_observations WHERE product_id=$1::uuid", [uuid(7)]);
    expect(privateRows.rows).toEqual([{ store_id: null, event_kind: "product_created" }]);
  });

  it("bounds the sample and omits an oversized identity without stopping the product save", async () => {
    const item = uuid(8);
    await db.exec(`INSERT INTO public.products(id,name,barcode,owner_store_id) VALUES('${item}',repeat('XYZ',4000),'08','A');
      DO $body$ BEGIN FOR counter IN 1..21 LOOP
        UPDATE public.products SET owner_store_id='B' WHERE id='${item}';
        UPDATE public.products SET owner_store_id='A' WHERE id='${item}';
      END LOOP; END $body$;`);
    const evidence = await observe("A", item);
    expect(evidence).toMatchObject({ membershipVerified: false, hasMoreObservations: true, revision: expect.stringMatching(/^stock-membership\.v1:43:\d+$/) });
    expect(evidence.observations).toHaveLength(20);
    expect(evidence.observations).toEqual(expect.arrayContaining([expect.objectContaining({ identity: null })]));
    expect((await db.query("SELECT length(name) AS length FROM public.products WHERE id=$1::uuid", [item])).rows[0]).toEqual({ length: 12000 });
  });

  it("denies direct table and function access, preserves append-only identity, and rejects an unknown install state", async () => {
    for (const role of ["anon", "authenticated", "service_role"]) {
      await db.exec(`SET ROLE ${role}`);
      try {
        await expect(db.exec("SELECT * FROM private.stock_history_product_membership_observations")).rejects.toThrow(/permission denied/);
        await expect(observe("A", uuid(1))).rejects.toThrow(/permission denied/);
      } finally {
        await db.exec("RESET ROLE");
      }
    }
    await expect(db.exec("UPDATE private.stock_history_product_membership_observations SET source_version=0")).rejects.toThrow(/IMMUTABLE/);
    await expect(db.exec("TRUNCATE private.stock_history_product_membership_observations")).rejects.toThrow(/IMMUTABLE/);
    await expect(observe("A", uuid(1), "1.1")).rejects.toThrow(/INVALID_REQUEST/);
    await expect(db.exec(prepared)).rejects.toThrow(/EXISTING_SCHEMA_REVIEW_REQUIRED/);
    await db.exec("ROLLBACK");
  });
});
