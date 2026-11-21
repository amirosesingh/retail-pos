import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createActualStockWriter } = require("../../../scripts/lib/stock-actual-writer-fixture.cjs");
const observationSql = readFileSync("scripts/preparation/stock-history-recorded-openings.sql", "utf8");
const stocktakeSql = readFileSync("scripts/preparation/stock-history-physical-stocktakes.sql", "utf8");
const cutoverSql = readFileSync("scripts/preparation/stock-history-stocktake-cutover.sql", "utf8");
const zeroProduct = randomUUID();
let fixture: Awaited<ReturnType<typeof createActualStockWriter>>;

type Plan = { candidateHash: string; pairsHash: string; ready: boolean };
type Receipt = { baselineId: string; observationStartedAt: string; observedAt: string };

beforeAll(async () => {
  fixture = await createActualStockWriter({ sourceAdmission: true, capturedAdjustment: true, preexistingZeroProduct: zeroProduct });
  for (const migration of ["20261106065813_stock_history_selected_time_period_reader.sql", "20261106073851_stock_history_coverage_frontiers.sql"]) {
    await fixture.db.exec(readFileSync(`supabase/migrations/${migration}`, "utf8"));
  }
  await fixture.db.exec(observationSql);
  await fixture.db.exec(stocktakeSql);
  await fixture.db.exec(cutoverSql);
}, 30_000);
afterAll(async () => fixture?.db.close());
beforeEach(async () => fixture.db.exec("BEGIN"));
afterEach(async () => fixture.db.exec("ROLLBACK"));

async function scalar<T>(sql: string, args: unknown[] = []): Promise<T> {
  return fixture.scalar(sql, args);
}

const preview = (actor = fixture.admin, branch = "A") => scalar<Plan>(
  "SELECT public.pos_stock_history_opening_plan($1,$2,$3)", [actor, fixture.terminal, branch]);

const observe = (plan: Plan, id: string = randomUUID(), reason = "Reviewed recorded test stock") => scalar<Receipt>(
  "SELECT public.pos_stock_history_publish_opening($1,$2,'A',$3,$4,$5)",
  [fixture.admin, fixture.terminal, id, plan.candidateHash, reason]);

async function denied(work: () => Promise<unknown>, pattern: string | RegExp) {
  await fixture.db.exec("SAVEPOINT opening_case");
  try { await expect(work()).rejects.toThrow(pattern); }
  finally { await fixture.db.exec("ROLLBACK TO SAVEPOINT opening_case; RELEASE SAVEPOINT opening_case"); }
}

const counts = () => scalar("SELECT jsonb_build_array((SELECT count(*) FROM public.stock_history_baselines)," +
  "(SELECT count(*) FROM public.stock_history_openings),(SELECT count(*) FROM private.stock_history_opening_publications))");

describe("isolated recorded stock openings", () => {
  it("stores the quantity and snapshot receipt while leaving the actual report and export unverified", async () => {
    expect(await counts()).toEqual([0, 0, 0]);
    const plan = await preview();
    expect(plan).toMatchObject({ ready: true, effectiveOpeningEligible: false, writerCoverage: "unknown" });
    expect(plan).not.toHaveProperty("pairs");
    expect(plan).not.toHaveProperty("snapshotHash");
    const receipt = await observe(plan);
    expect(receipt).toMatchObject({ effectiveOpeningEligible: false, writerCoverage: "unknown", observationGrade: "recorded_system_snapshot" });
    expect(receipt.observationStartedAt <= receipt.observedAt).toBe(true);
    const stored = await scalar("SELECT jsonb_build_object('opening',b.verification_state,'cursor',b.source_cursor::text," +
      "'verifiedBy',b.verified_by,'snapshot',p.source_revision->>'snapshotHash','qty',o.quantity::text) " +
      "FROM public.stock_history_baselines b JOIN private.stock_history_opening_publications p ON b.id=p.baseline_id " +
      "JOIN public.stock_history_openings o ON b.id=o.baseline_id WHERE b.id=$1 AND o.product_id=$2", [receipt.baselineId, fixture.product]);
    expect(stored).toEqual({ opening: "unverified", cursor: "0", verifiedBy: null, snapshot: expect.stringMatching(/^[a-f0-9]{64}$/), qty: "10" });
    expect(await scalar("SELECT count(*) FROM public.stock_history_heads")).toBe(0);
    const midnight = `${receipt.observedAt.slice(0, 10)}T00:00:00.0000000Z`;
    for (const exportRequested of [false, true]) {
      const args = [fixture.admin, fixture.terminal, receipt.observedAt, exportRequested];
      const point = await scalar("SELECT public.pos_stock_history_page($1,$2,'A',$3,'UTC',NULL,100,NULL,$4,NULL)", args);
      const period = await scalar("SELECT public.pos_stock_history_period_page($1,$2,'A',$3,'UTC',NULL,100,NULL,$4,NULL,$5)", [...args, midnight]);
      for (const page of [point, period]) {
        expect(page).toMatchObject({ status: "incomplete", reasons: ["NO_VERIFIED_OPENING"], rows: [] });
      }
    }
    expect(await fixture.stock()).toBe("10");
  });

  it("replays only the immutable observation and refuses changed evidence", async () => {
    const plan = await preview(), receipt = await observe(plan);
    expect(await observe(plan, receipt.baselineId)).toEqual(receipt);
    await denied(() => observe(plan, receipt.baselineId, "Changed review reason"), "STOCK_OPENING_REPLAY_CONFLICT");
    await denied(() => fixture.db.query("UPDATE public.stock_history_baselines SET verification_state='verified' WHERE id=$1", [receipt.baselineId]), "STOCK_HISTORY_IMMUTABLE");
    expect(await counts()).toEqual([1, 2, 1]);
  });

  it("requires the bound Administrator and denies a foreign branch", async () => {
    await denied(() => preview(fixture.author), /STOCK_(?:OPENING_ADMIN_REQUIRED|HISTORY_ACTOR_DENIED|HISTORY_PERMISSION_DENIED)/);
    await denied(() => preview(fixture.admin, "B"), "STOCK_HISTORY_BRANCH_DENIED");
    expect(await scalar("SELECT has_function_privilege('authenticated','public.pos_stock_history_publish_opening(text,text,text,uuid,text,text)','EXECUTE')")).toBe(false);
    expect(await counts()).toEqual([0, 0, 0]);
  });

  it("holds a real accepted stock effect until its original movement is admitted", async () => {
    const before = await preview(), operation = await fixture.sourceOperation();
    await operation.upload();
    const pending = await preview();
    expect(pending).toMatchObject({ ready: false, reasons: ["UNVALIDATED_STOCK_EFFECTS"] });
    await denied(() => observe(pending), "STOCK_OPENING_EVIDENCE_REQUIRED");
    await operation.accept();
    await denied(() => observe(before), "STOCK_OPENING_SOURCE_CHANGED");
    const receipt = await observe(await preview());
    expect(await scalar("SELECT source_cursor::text FROM public.stock_history_baselines WHERE id=$1", [receipt.baselineId])).toBe("1");
    expect(await scalar("SELECT baseline_id FROM public.stock_history_heads WHERE store_id='A'")).toBeNull();
    expect(await fixture.stock()).toBe("7");
  });

  it("rolls back both opening rows and observation receipt if publication fails after capture", async () => {
    await fixture.db.exec(`CREATE FUNCTION private.stock_opening_fixture_failure() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN RAISE EXCEPTION 'OWNED_OBSERVATION_FAILURE'; END $$;
      CREATE TRIGGER stock_opening_fixture_failure BEFORE INSERT ON private.stock_history_opening_publications
        FOR EACH ROW EXECUTE FUNCTION private.stock_opening_fixture_failure()`);
    const plan = await preview();
    await denied(() => observe(plan), "OWNED_OBSERVATION_FAILURE");
    expect(await counts()).toEqual([0, 0, 0]);
    expect(await fixture.stock()).toBe("10");
  });
});

describe("full-branch physical stocktake preparation", () => {
  it("requires an explicit canonical count for every frozen product including physical zero", async () => {
    const id = randomUUID();
    const start = () => scalar<{ rosterHash: string; roster: { id: string }[] }>(
      "SELECT public.pos_stock_history_start_stocktake($1,$2,$3,'A',$4)",
      [fixture.admin, fixture.terminal, fixture.stockSourceFixture.project, id]);
    const opened = await start();
    expect(opened.roster.map(row => row.id).sort()).toEqual([fixture.product, zeroProduct].sort());
    await fixture.db.exec("SET LOCAL TIME ZONE 'Asia/Brunei'");
    expect(await start()).toEqual(opened);
    const at = await scalar<string>(`SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US')||'0Z'`);
    const seal = (lines: unknown, cutoff = at) => scalar("SELECT public.pos_stock_history_seal_stocktake($1,$2,'A',$3,$4,$5,$6::jsonb,'{}')",
      [fixture.admin, fixture.terminal, id, opened.rosterHash, cutoff, JSON.stringify(lines)]);
    await denied(() => seal([[fixture.product, "10"]]), "STOCKTAKE_ROSTER_INCOMPLETE");
    await denied(() => seal([[fixture.product, "10"], [zeroProduct, 0]]), "STOCKTAKE_INVALID");
    await denied(() => seal([[fixture.product, "10"], [zeroProduct, "-0"]]), "STOCKTAKE_INVALID");
    await denied(() => seal([[fixture.product, "10"], [fixture.product, "10"]]), "STOCKTAKE_DUPLICATE_INPUT");
    await denied(() => seal([[fixture.product, "10"], [zeroProduct, "0"]], "2099-01-01T00:00:00.0000000Z"), "STOCKTAKE_CUTOFF_OUTSIDE_OBSERVATION");
    await denied(() => seal([[fixture.product, "10"], [zeroProduct, "1"]]), "STOCKTAKE_QUANTITIES_UNRECONCILED");
    const count = await seal([[fixture.product, "10"], [zeroProduct, "0"]]);
    expect(count).toMatchObject({ countedPairs: 2, corrections: 0, state: "awaiting_independent_review" });
    expect(await seal([[zeroProduct, "0"], [fixture.product, "10"]])).toEqual(count);
    expect(await scalar("SELECT count(*) FROM public.stock_history_baselines")).toBe(0);
  });

  it("keeps stocktake evidence branch-bound, append-only and confined to the service RPCs", async () => {
    const id = randomUUID(), args = [fixture.admin, fixture.terminal, fixture.stockSourceFixture.project, id];
    await denied(() => scalar("SELECT public.pos_stock_history_start_stocktake($1,$2,$3,'B',$4)", args), "STOCK_HISTORY_BRANCH_DENIED");
    await denied(() => scalar("SELECT public.pos_stock_history_start_stocktake($1,$2,$3,'A',$4)", [fixture.author, ...args.slice(1)]),
      /STOCK_(?:OPENING_ADMIN_REQUIRED|HISTORY_ACTOR_DENIED|HISTORY_PERMISSION_DENIED)/);
    await scalar("SELECT public.pos_stock_history_start_stocktake($1,$2,$3,'A',$4)", args);
    expect(await scalar("SELECT has_function_privilege('authenticated','public.pos_stock_history_stocktake_for_review(text,text,text,uuid)','EXECUTE')")).toBe(false);
    expect(await scalar("SELECT has_table_privilege('service_role','private.stock_history_stocktakes','INSERT')")).toBe(false);
    await denied(() => fixture.db.query("DELETE FROM private.stock_history_stocktakes WHERE id=$1", [id]), "STOCK_HISTORY_IMMUTABLE");
    await denied(() => scalar("SELECT public.pos_stock_history_stocktake_for_review($1,$2,'A',$3)", [fixture.admin, fixture.terminal, id]),
      "STOCKTAKE_COUNT_REQUIRED");
  });
});

it("addresses immutable lease and release readbacks to the exact enrolled terminal and database", async () => {
  const { project, database } = fixture.stockSourceFixture;
  const id = randomUUID(), marker = "CODEX-STOCK401-READBACK";
  const scoped = [fixture.admin, fixture.terminal, project, "A", id];
  const loadLease = (purpose: string, actualDatabase: string = database, actualId: string = id) => scalar(
    "SELECT public.pos_stock_history_load_stocktake_lease($1,$2,$3,$4,$5,$6,$7)",
    [...scoped.slice(0, 4), actualId, actualDatabase, purpose]);
  const loadRelease = (actualDatabase: string = database) => scalar(
    "SELECT public.pos_stock_history_load_stocktake_release($1,$2,$3,$4,$5,$6)", [...scoped, actualDatabase]);
  await fixture.db.exec(`ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS parent_id text,
    ADD COLUMN IF NOT EXISTS archived_at timestamptz,ADD COLUMN IF NOT EXISTS code text;`);
  await fixture.db.query("UPDATE public.stores SET code=$1 WHERE id='A'", [marker]);
  await scalar("SELECT private.stock_history_install_cutover_guard($1,'A',$2,ARRAY[$3::uuid],ARRAY[$4::uuid])", [project, marker, fixture.terminal, database]);
  const prepare = () => scalar<{ leaseIssuedAt: string; leaseExpiresAt: string }>(
    "SELECT public.pos_stock_history_prepare_stocktake_pause($1,$2,$3,$4,$5)", scoped);
  const lease = await prepare();
  const response = await loadLease("arm");
  expect(response).toEqual({ ...lease, terminalId: fixture.terminal, databaseId: database, state: "draining" });
  expect(await loadLease("arm")).toEqual(response);
  expect(await prepare()).toEqual(lease);
  await denied(() => loadLease("arm", randomUUID()), "STOCK_CUTOVER_SCOPE_UNCONFIRMED");
  await denied(() => loadLease("arm", database, randomUUID()), "STOCK_CUTOVER_LEASE_CLOSED");
  await denied(() => loadLease("confirm"), "STOCK_CUTOVER_STOCKTAKE_REQUIRED");
  await denied(() => loadRelease(), "STOCK_CUTOVER_RELEASE_UNCONFIRMED");
  const released = await scalar<{ releasedAt: string }>("SELECT public.pos_stock_history_release_stocktake_pause($1,$2,$3,$4,$5)", scoped);
  expect(await loadRelease()).toMatchObject({ ...released, projectOrigin: project, terminalId: fixture.terminal, databaseId: database, state: "released" });
  expect(await loadLease("release")).toMatchObject({ ...lease, state: "released" });
  await denied(() => loadLease("arm"), "STOCK_CUTOVER_LEASE_CLOSED");
  await denied(() => loadRelease(randomUUID()), "STOCK_CUTOVER_SCOPE_UNCONFIRMED");
  expect(await scalar("SELECT count(*) FROM public.stock_history_baselines")).toBe(0);
});
