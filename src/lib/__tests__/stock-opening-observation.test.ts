import { createHash, randomUUID, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { stockCoverageFrontierJson } from "../../../electron/shared/stock-coverage-frontier.mjs";

const require = createRequire(import.meta.url);
const { createActualStockWriter } = require("../../../scripts/lib/stock-actual-writer-fixture.cjs");
const { stockCoverageFrontierMessage } = require("../../../electron/security/stock-event-author-protocol.cjs");
const observationSql = readFileSync("scripts/preparation/stock-history-recorded-openings.sql", "utf8");
const rolloutSql = readFileSync("scripts/preparation/stock-history-rollout-observation.sql", "utf8");
const stocktakeSql = readFileSync("scripts/preparation/stock-history-physical-stocktakes.sql", "utf8");
const cutoverSql = readFileSync("scripts/preparation/stock-history-stocktake-cutover.sql", "utf8");
const activationSql = readFileSync("scripts/preparation/stock-history-rollout-activation.sql", "utf8");
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
  await fixture.db.exec(rolloutSql);
  await fixture.db.exec(rolloutSql);
  await fixture.db.exec(activationSql);
  await fixture.db.exec(activationSql);
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

const initializeRollout = (actor = fixture.admin, branch = "A") => scalar(
  "SELECT public.pos_stock_history_initialize_rollout_opening($1,$2,$3)", [actor, fixture.terminal, branch]);

describe("isolated recorded stock openings", () => {
  it("reports location registrations for review without treating a desktop or an unknown device as confirmed", async () => {
    const { project } = fixture.stockSourceFixture;
    await fixture.db.query(`INSERT INTO public.terminal_tokens
      (id,location_id,status,revoked_at,platform,is_claimed,claimed_at,management_sync_enabled) VALUES
      ($1,'A','revoked',now(),'pc',false,now(),true),
      ($2,'A','active',NULL,'mobile',true,now(),false),
      ($3,'A','used',NULL,NULL,false,NULL,false),
      ($4,'B','active',NULL,'pc',true,now(),false),
      ($5,NULL,'active',NULL,'pc',true,now(),true),
      ($6,'A','active',NULL,'pc',false,NULL,false)`, Array.from({ length: 6 }, () => randomUUID()));
    const result = await scalar("SELECT public.pos_stock_history_rollout_readiness($1,$2,$3,'A')",
      [fixture.admin, fixture.terminal, project]);
    expect(result).toEqual({
      branchId: "A", writers: 0, confirmed: 0, reasons: ["ROLLOUT_SCOPE_UNCONFIRMED"],
      registrationInventory: { desktop: 2, mobile: 1, unknown: 1, hasUnassignedLocalCandidate: true },
    });
    expect(await scalar("SELECT has_function_privilege('authenticated','public.pos_stock_history_rollout_readiness(text,text,text,text)','EXECUTE')")).toBe(false);
    await denied(() => scalar("SELECT public.pos_stock_history_rollout_readiness($1,$2,$3,'B')",
      [fixture.admin, fixture.terminal, project]), "STOCK_HISTORY_BRANCH_DENIED");
    expect(await counts()).toEqual([0, 0, 0]);
    expect(await fixture.stock()).toBe("10");
  });

  it("checks rollout readiness without opening a writer fence or changing stock", async () => {
    const { project, database, key, pair } = fixture.stockSourceFixture;
    const readiness = (actor = fixture.admin, origin = project, branch = "A") => scalar(
      "SELECT public.pos_stock_history_rollout_readiness($1,$2,$3,$4)", [actor, fixture.terminal, origin, branch]);
    const registrationInventory = { desktop: 1, mobile: 0, unknown: 0, hasUnassignedLocalCandidate: false };
    expect(await readiness()).toEqual({ branchId: "A", writers: 0, confirmed: 0, reasons: ["ROLLOUT_SCOPE_UNCONFIRMED"], registrationInventory });
    await denied(() => readiness(fixture.author), /STOCK_(?:OPENING_ADMIN_REQUIRED|HISTORY_ACTOR_DENIED|HISTORY_PERMISSION_DENIED)/);
    await denied(() => readiness(fixture.admin, project, "B"), "STOCK_HISTORY_BRANCH_DENIED");
    const marker = "CODEX-STOCK401-READINESS";
    await fixture.db.exec(`ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS parent_id text,
      ADD COLUMN IF NOT EXISTS archived_at timestamptz,ADD COLUMN IF NOT EXISTS code text;`);
    await fixture.db.query("UPDATE public.stores SET code=$1 WHERE id='A'", [marker]);
    await scalar("SELECT private.stock_history_install_cutover_guard($1,'A',$2,ARRAY[$3::uuid],ARRAY[$4::uuid])",
      [project, marker, fixture.terminal, database]);
    expect(await readiness()).toEqual({ branchId: "A", writers: 1, confirmed: 0, reasons: ["ROLLOUT_WRITERS_PENDING"], registrationInventory });
    expect(await readiness(fixture.admin, "https://different.example")).toMatchObject({
      writers: 0, confirmed: 0, reasons: ["ROLLOUT_SCOPE_UNCONFIRMED"],
    });
    const hash = (value: string) => createHash("sha256").update(value).digest("hex");
    async function observeWriter(pendingBusiness: string) {
      const challengeId = randomUUID();
      const challenge = await scalar<{ nonce: string; cohortHash: string; issuedAt: string }>(
        "SELECT public.pos_stock_history_frontier_challenge($1,$2,'A',$3,$4,$5)",
        [challengeId, project, fixture.terminal, fixture.author, key]);
      const frontier = stockCoverageFrontierJson({
        version: 1, projectOrigin: project, branchId: "A", terminalId: fixture.terminal,
        authorId: fixture.author, databaseId: database, challengeId, nonce: challenge.nonce,
        cohortHash: challenge.cohortHash, writerRevision: "stock-history-source.v1",
        sourceSequence: "0", sourceRoot: null, sourceGeneration: "a".repeat(64), gapHash: hash("[]"),
        pending: { business: pendingBusiness, metadata: "0", unsigned: "0", unknown: "0" }, observedAt: challenge.issuedAt,
      });
      const fields = { version: 1, algorithm: "Ed25519", keyId: key, projectOrigin: project,
        terminalId: fixture.terminal, authorId: fixture.author, subject: fixture.author, branchId: "A",
        challengeId, frontierHash: hash(frontier) };
      const proof = JSON.stringify({ ...fields, signature: sign(null, Buffer.from(stockCoverageFrontierMessage(fields)), pair.privateKey).toString("base64url") });
      return scalar("SELECT public.pos_stock_history_accept_frontier($1,'A',$2,$3,$4,true)",
        [project, fixture.terminal, frontier, proof]);
    }
    expect(await observeWriter("0")).toMatchObject({ state: "accepted" });
    expect(await readiness()).toEqual({ branchId: "A", writers: 1, confirmed: 1, reasons: [], registrationInventory });
    expect(await observeWriter("3")).toMatchObject({ state: "unconfirmed", reasons: ["PENDING_BUSINESS"] });
    expect(await readiness()).toEqual({ branchId: "A", writers: 1, confirmed: 0, reasons: ["ROLLOUT_WRITERS_PENDING"], registrationInventory });
    expect(await counts()).toEqual([0, 0, 0]);
    expect(await scalar("SELECT count(*) FROM private.stock_history_cutover_leases")).toBe(0);
    expect(await fixture.stock()).toBe("10");
  });

  it("captures one rollout snapshot, keeps its observed time on retry, and leaves stock unchanged", async () => {
    const first = await initializeRollout();
    expect(first).toMatchObject({ status: "recorded", branchId: "A", productCount: 2, cutoff: expect.stringMatching(/Z$/) });
    const operation = await fixture.sourceOperation();
    await operation.upload();
    expect(await initializeRollout()).toEqual(first);
    expect(await counts()).toEqual([1, 2, 1]);
    expect(await scalar("SELECT verification_state FROM public.stock_history_baselines")).toBe("unverified");
    expect(await scalar("SELECT quantity::text FROM public.stock_history_openings WHERE product_id=$1", [fixture.product])).toBe("10");
    expect(await fixture.stock()).toBe("7");
  });

  it("waits for captured effects and restricts rollout to the authorized Administrator", async () => {
    await denied(() => initializeRollout(fixture.author), /STOCK_(?:OPENING_ADMIN_REQUIRED|HISTORY_ACTOR_DENIED|HISTORY_PERMISSION_DENIED)/);
    await denied(() => initializeRollout(fixture.admin, "B"), "STOCK_HISTORY_BRANCH_DENIED");
    expect(await scalar("SELECT has_function_privilege('authenticated','public.pos_stock_history_initialize_rollout_opening(text,text,text)','EXECUTE')")).toBe(false);
    const operation = await fixture.sourceOperation();
    await operation.upload();
    expect(await initializeRollout()).toEqual({ status: "waiting", branchId: "A", reasons: ["UNVALIDATED_STOCK_EFFECTS"] });
    expect(await counts()).toEqual([0, 0, 0]);
    await operation.accept();
    expect(await initializeRollout()).toMatchObject({ status: "recorded", branchId: "A", productCount: 2 });
    expect(await scalar("SELECT quantity::text FROM public.stock_history_openings WHERE product_id=$1", [fixture.product])).toBe("7");
  });

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

it("activates a fenced reporting-only opening at database time, including zero stock", async () => {
  const { project, database, key, pair } = fixture.stockSourceFixture;
  const id = randomUUID(), marker = "CODEX-STOCK401-ROLLOUT";
  const scope = [fixture.admin, fixture.terminal, project, "A", id];
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  const dbTime = () => scalar<string>("SELECT private.stock_history_cutover_utc(clock_timestamp())");
  const activate = (proofs: unknown, args = scope) => scalar<{ cutoff: string }>(
    "SELECT public.pos_stock_history_activate_rollout($1,$2,$3,$4,$5,$6::jsonb)", [...args, JSON.stringify(proofs)]);
  const prepare = (args = scope) => scalar<{ leaseIssuedAt: string; leaseExpiresAt: string }>(
    "SELECT public.pos_stock_history_prepare_stocktake_pause($1,$2,$3,$4,$5)", args);
  const readReport = (cutoff: string) => scalar("SELECT public.pos_stock_history_page($1,$2,'A',$3,'UTC',NULL,100,NULL,false,NULL)",
    [fixture.admin, fixture.terminal, cutoff]);
  await fixture.db.exec(`ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS parent_id text,
    ADD COLUMN IF NOT EXISTS archived_at timestamptz, ADD COLUMN IF NOT EXISTS code text;`);
  await fixture.db.query("UPDATE public.stores SET code=$1 WHERE id='A'", [marker]);
  await scalar("SELECT private.stock_history_install_cutover_guard($1,'A',$2,ARRAY[$3::uuid],ARRAY[$4::uuid])",
    [project, marker, fixture.terminal, database]);
  const lease = await prepare();
  const claim = { terminalId: fixture.terminal, databaseId: database, challengeId: randomUUID(),
    fenceGeneration: randomUUID(), localFencedAt: await dbTime(), localExpiresAt: lease.leaseExpiresAt };
  const challenge = await scalar<{ nonce: string; cohortHash: string }>(
    "SELECT public.pos_stock_history_frontier_challenge($1,$2,'A',$3,$4,$5)",
    [claim.challengeId, project, fixture.terminal, fixture.author, key]);
  const gapHash = hash(["stock401-pause-v1", "arm", project, "A", id, claim.terminalId, claim.challengeId,
    database, claim.fenceGeneration, claim.localFencedAt, claim.localExpiresAt].join("\x1f"));
  const frontier = stockCoverageFrontierJson({
    version: 1, projectOrigin: project, branchId: "A", terminalId: fixture.terminal,
    authorId: fixture.author, databaseId: database, challengeId: claim.challengeId, nonce: challenge.nonce,
    cohortHash: challenge.cohortHash, writerRevision: "stock-history-source.v1", sourceSequence: "0", sourceRoot: null,
    sourceGeneration: "a".repeat(64), gapHash, pending: { business: "0", metadata: "0", unsigned: "0", unknown: "0" },
    observedAt: await dbTime(),
  });
  const fields = { version: 1, algorithm: "Ed25519", keyId: key, projectOrigin: project,
    terminalId: fixture.terminal, authorId: fixture.author, subject: fixture.author, branchId: "A",
    challengeId: claim.challengeId, frontierHash: hash(frontier) };
  const proof = JSON.stringify({ ...fields,
    signature: sign(null, Buffer.from(stockCoverageFrontierMessage(fields)), pair.privateKey).toString("base64url") });
  expect(await scalar("SELECT public.pos_stock_history_accept_frontier($1,'A',$2,$3,$4,true)",
    [project, fixture.terminal, frontier, proof])).toMatchObject({ state: "accepted" });
  await denied(() => activate([]), "STOCK_CUTOVER_PROOFS_INVALID");
  await denied(() => activate([{ ...claim, databaseId: randomUUID() }]), "STOCK_CUTOVER_PROOFS_UNCONFIRMED");
  await denied(() => activate([claim], [fixture.admin, fixture.terminal, "https://other.fixture", "A", id]), "STOCK_CUTOVER_SCOPE_UNCONFIRMED");
  expect(await counts()).toEqual([0, 0, 0]);
  const before = await dbTime();
  const opened = await activate([claim]);
  const after = await dbTime();
  expect(opened).toEqual({ baselineId: id, branchId: "A", cutoff: expect.any(String), verificationState: "verified",
    openingKind: "system_snapshot", productCount: 2 });
  expect(opened.cutoff > before && opened.cutoff < after).toBe(true);
  expect(await readReport(opened.cutoff)).toMatchObject({ status: "complete" });
  expect(await readReport(after)).toMatchObject({ reasons: expect.arrayContaining(["INCOMPLETE_MOVEMENTS"]) });
  const pairs = await scalar("SELECT jsonb_object_agg(product_id::text,quantity::text) FROM public.stock_history_openings WHERE baseline_id=$1", [id]);
  expect(pairs).toEqual({ [fixture.product]: "10", [zeroProduct]: "0" });
  expect(await fixture.stock()).toBe("10");
  await scalar("SELECT public.pos_stock_history_release_stocktake_pause($1,$2,$3,$4,$5)", scope);
  expect(await activate([claim])).toEqual(opened);
  await denied(() => activate([{ ...claim, fenceGeneration: randomUUID() }]), "STOCK_CUTOVER_REPLAY_CONFLICT");
  const next = [...scope.slice(0, 4), randomUUID()];
  await prepare(next);
  await denied(() => activate([claim], next), "STOCK_CUTOVER_ALREADY_PUBLISHED");
  expect(await counts()).toEqual([1, 2, 0]);
  expect(await scalar("SELECT has_function_privilege('authenticated','public.pos_stock_history_activate_rollout(text,text,text,text,uuid,jsonb)','EXECUTE')")).toBe(false);
});
