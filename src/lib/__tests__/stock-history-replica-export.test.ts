import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { stockHistoryDownload } from "../stock-history-download.server";

const { serviceRest } = vi.hoisted(() => ({ serviceRest: vi.fn() }));
const { checkManifest, beginDownload, appendPage } = createRequire(import.meta.url)("../../../electron/sync/stock-history-download.cjs");
vi.mock("@/core/api/pos-relay.server", () => ({ serviceRest }));
vi.mock("../external-supabase-config", () => ({ supabaseConfig: () => ({ url: "https://beta.fixture" }) }));

const repo = new URL("../../../", import.meta.url), db = new PGlite();
const terminalId = "11111111-1111-4111-8111-111111111111";
const second = "11111111-1111-4111-8111-111111111112";
const baseline = "22222222-2222-4222-8222-222222222222";
const product = "33333333-3333-4333-8333-333333333333";
const start = "2026-11-21T00:00:00.0000000Z", end = "2026-11-21T00:01:00.0000000Z";
const scope = { version: 1 as const, branchId: "A", terminalId };
const terminal = { id: terminalId, branchId: "A", platform: "pc", mode: "operations" } as Parameters<typeof stockHistoryDownload>[1];
const signal = new AbortController().signal;
const manifest = () => stockHistoryDownload({ ...scope, action: "manifest" }, terminal, signal);
const page = (snapshotId: string, revision: string, index: number) =>
  stockHistoryDownload({ ...scope, action: "page", snapshotId, revision, index }, terminal, signal);

beforeAll(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA private; CREATE SCHEMA auth;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT 'service_role'::text$$;
    CREATE TABLE app_users(user_id text PRIMARY KEY,role text,role_slug text,store_id text,is_active boolean,permissions jsonb);
    CREATE TABLE stores(id text PRIMARY KEY);
    CREATE TABLE terminal_tokens(id uuid PRIMARY KEY,location_id text,status text,revoked_at timestamptz,
      platform text,is_claimed boolean,claimed_at timestamptz,management_sync_enabled boolean);
    CREATE TABLE products(id uuid PRIMARY KEY,name text,sku text,barcode text,owner_store_id text,stock_by_store jsonb,stock_quantity integer);
    CREATE TABLE stock_delta_applied(movement_id uuid PRIMARY KEY,product_id uuid,store_id text,delta integer);
    CREATE TABLE shifts(id uuid PRIMARY KEY,store_id text,status text,closed_at timestamptz);
    CREATE FUNCTION public.pos_sync_validate_scope(text,text,text) RETURNS void LANGUAGE plpgsql AS $$BEGIN RETURN; END$$;
    INSERT INTO stores VALUES('A'),('B');
    INSERT INTO terminal_tokens VALUES('${terminalId}','A','active',NULL,'pc',true,NULL,false),
      ('${second}','B','active',NULL,'pc',true,NULL,false);
    INSERT INTO products VALUES('${product}','Grain','0004','004','A','{"A":0}',0);`);
  for (const path of ["supabase/migrations/20261105113916_stock_history_effective_ledger.sql",
    "supabase/migrations/20261105172030_stock_history_accepted_effect_capture.sql",
    "scripts/preparation/stock-history-replica-export.sql"]) await db.exec(await readFile(new URL(path, repo), "utf8"));

  serviceRest.mockImplementation(async (route: string, init: { body: string }) => {
    const { p_branch, p_terminal, p_snapshot, p_index } = JSON.parse(init.body);
    try {
      const reply = route.endsWith("_manifest")
        ? await db.query("SELECT public.pos_stock_history_replica_manifest($1,$2) result", [p_branch, p_terminal])
        : await db.query("SELECT public.pos_stock_history_replica_page($1,$2,$3,$4) result", [p_branch, p_terminal, p_snapshot, p_index]);
      return Response.json((reply.rows[0] as { result: unknown }).result);
    } catch (error) {
      const failure = error as { message: string; code: string };
      return Response.json({ message: failure.message }, { status: failure.code === "42501" ? 403 : 400 });
    }
  });
}, 30000);
afterAll(async () => { await db.close(); });

describe("Stock Report replica export", () => {
  it("withholds incomplete data, exports exact ordered pages and withdraws when the capture changes", async () => {
    expect(await (await manifest()).json()).toMatchObject({ manifest: null });
    const denied = await stockHistoryDownload({ ...scope, action: "manifest", branchId: "B" }, terminal, signal);
    expect(denied.status).toBe(403);
    await expect(db.query("SELECT public.pos_stock_history_replica_manifest('A',$1)", [second])).rejects.toThrow("STOCK_HISTORY_REPLICA_SCOPE_DENIED");

    // These committed fixtures stand in for an already verified source head.
    // No part of the download may create one or interpret an ordinary count.
    await db.query(`INSERT INTO public.stock_history_baselines VALUES($1,'A',$2,private.stock_history_ticks($2),
      $3,private.stock_history_ticks($3),41,'physical_count','verified',1,'{}','reviewer',repeat('a',64))`, [baseline, start, end]);
    await db.query(`INSERT INTO public.stock_history_openings VALUES(gen_random_uuid(),$1,$2,'A',0,'Grain','0004','004','A')`, [baseline, product]);
    const mid = "2026-11-21T00:00:15.0000000Z";
    const movementId = "44444444-4444-4444-8444-444444444444", operationId = "55555555-5555-4555-8555-555555555555";
    const payload = JSON.stringify([1, movementId, operationId, product, "A", terminalId, "actor", "receiving", "5",
      mid, String(BigInt(Date.parse(mid)) * 10000n), mid, "Grain", "0004", "004", "verified", [], "5"]);
    await db.query(`INSERT INTO public.stock_history_movements(id,operation_id,product_id,store_id,terminal_id,actor_id,source_kind,
      quantity_delta,effective_at_raw,effective_ticks,recorded_at_raw,recorded_ticks,product_name,sku,barcode,clock_state,
      payload_hash,payload_json,ingested_cursor,ingested_at)
      SELECT $4,$5,$1,'A',$2,'actor','receiving',5,$3,private.stock_history_ticks($3),$3,
      private.stock_history_ticks($3),'Grain','0004','004','verified',encode(sha256(convert_to($6,'UTF8')),'hex'),$6,42,$3::timestamptz`,
    [product, terminalId, mid, movementId, operationId, payload]);
    await db.query(`INSERT INTO public.stock_history_heads(store_id,baseline_id,committed_cursor,coverage_generation,coverage_state,coverage_from_ticks,coverage_through_ticks)
      VALUES('A',$1,42,2,'complete',private.stock_history_ticks($2),private.stock_history_ticks($3))`, [baseline, start, end]);

    const published = await (await manifest()).json();
    expect(published).toMatchObject({ terminalId, projectOrigin: "https://beta.fixture", manifest: {
      headCursor: "42", coverageGeneration: "1", baseline: [baseline, start, end, "41", "physical_count", 1, "reviewer", "a".repeat(64), "{}"],
      pages: [["openings", 1, expect.any(String)], ["movements", 1, expect.any(String)]],
    } });
    expect(await (await manifest()).json()).toEqual(published);
    const { snapshotId, revision } = published.manifest;
    expect((await page(snapshotId, "0".repeat(64), 0)).status).toBe(409);
    const openings = await (await page(snapshotId, revision, 0)).json();
    expect(JSON.parse(openings.rowsJson)).toEqual([[expect.any(String), product, "0", "Grain", "0004", "004", "A"]]);
    const movements = await (await page(snapshotId, revision, 1)).json();
    expect(JSON.parse(movements.rowsJson)).toEqual([["42", mid, expect.any(String), payload]]);
    const nativeScope = { branchId: scope.branchId, terminalId, projectOrigin: "https://beta.fixture" };
    const staged = beginDownload(checkManifest(published, nativeScope));
    appendPage(staged, openings, nativeScope);
    appendPage(staged, movements, nativeScope);
    expect(staged.movements).toMatchObject([{ id: movementId, delta: "5", ingestedCursor: "42" }]);

    await db.query(`UPDATE products SET stock_by_store='{"A":1}' WHERE id=$1`, [product]);
    expect((await page(snapshotId, revision, 0)).status).toBe(409);
    const withdrawn = await (await manifest()).json();
    expect(withdrawn).toMatchObject({ manifest: null, withdrawal: { coverageGeneration: "2" } });
    expect(await (await manifest()).json()).toEqual(withdrawn);
    expect(await db.query("SELECT count(*)::int n FROM private.stock_history_replica_snapshots")).toMatchObject({ rows: [{ n: 1 }] });
  });

  it("leaves internal custody tables and publisher inaccessible to API roles", async () => {
    expect(await db.query(`SELECT has_table_privilege('service_role','private.stock_history_replica_pages','SELECT') raw,
      has_function_privilege('authenticated','public.pos_stock_history_replica_manifest(text,text)','EXECUTE') api`))
      .toMatchObject({ rows: [{ raw: false, api: false }] });
  });
});
