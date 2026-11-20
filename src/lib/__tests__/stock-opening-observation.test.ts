import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createActualStockWriter } = require("../../../scripts/lib/stock-actual-writer-fixture.cjs");
const observationSql = readFileSync("scripts/preparation/stock-history-recorded-openings.sql", "utf8");
let fixture: Awaited<ReturnType<typeof createActualStockWriter>>;

type Plan = { candidateHash: string; pairsHash: string; ready: boolean };
type Receipt = { baselineId: string; observationStartedAt: string; observedAt: string };

beforeAll(async () => {
  fixture = await createActualStockWriter({ sourceAdmission: true, capturedAdjustment: true });
  for (const migration of ["20261106065813_stock_history_selected_time_period_reader.sql", "20261106073851_stock_history_coverage_frontiers.sql"]) {
    await fixture.db.exec(readFileSync(`supabase/migrations/${migration}`, "utf8"));
  }
  await fixture.db.exec(observationSql);
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
      "JOIN public.stock_history_openings o ON b.id=o.baseline_id WHERE b.id=$1", [receipt.baselineId]);
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
    expect(await counts()).toEqual([1, 1, 1]);
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
