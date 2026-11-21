const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

module.exports = async function physicalStocktakes({ control, one, two, f, bind, pass, header, acceptOpeningFrontier }) {
  const firstStock = await f.stock();
  const { project } = f.stockSourceFixture;
  const read = (session, sql, args = []) => session.query(bind(sql, args)).then(rows => Object.values(rows[0])[0]);
  const cutoff = session => read(session, `SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US')||'0Z'`);
  const start = async (session, id) => JSON.parse(await read(session,
    "SELECT public.pos_stock_history_start_stocktake($1,$2,$3,'A',$4)", [f.admin, f.terminal, project, id]));
  const seal = async (session, opened, at, counts, movements) => JSON.parse(await read(session,
    "SELECT public.pos_stock_history_seal_stocktake($1,$2,'A',$3,$4,$5,$6::jsonb,$7::uuid[])",
    [f.admin, f.terminal, opened.stocktakeId, opened.rosterHash, at, JSON.stringify(counts), `{${movements.join(",")}}`]));
  const review = async (actor, id, evidence, frontiers) => JSON.parse(await read(control,
    "SELECT public.pos_stock_history_review_stocktake($1,$2,'A',$3,$4,$5::uuid[])",
    [actor, f.terminal, id, evidence, `{${frontiers.join(",")}}`]));
  const absent = async (work, reason) => {
    await control.query("SAVEPOINT stocktake_case");
    try { await assert.rejects(work, reason); }
    finally { await control.query("ROLLBACK TO SAVEPOINT stocktake_case; RELEASE SAVEPOINT stocktake_case"); }
  };

  // The existing mutation and source admission are executed without replacing
  // either writer or hand-creating a receipt. Roll back only this fixture run.
  await control.query("BEGIN");
  try {
    const reviewer = randomUUID();
    await control.query(bind(`INSERT INTO app_users(id,user_id,role,role_slug,permissions,is_active,store_id)
      VALUES($1::uuid,$1::text,'admin','admin','{}'::jsonb,true,'A')`, [reviewer]));
    const oldFrontier = await acceptOpeningFrontier({});
    const id = randomUUID(), opened = await start(control, id), beforeCorrection = await cutoff(control);
    assert.equal(opened.roster.length, 1);
    const correctionSource = { sourceSequence: "2", sourcePredecessorRoot: header.sourceRoot, stocktakeId: id };
    await control.query("SAVEPOINT future_effective_adjustment");
    try {
      const future = await f.sourceOperation({ ...correctionSource, at: "2099-01-01T00:00:00.0000000Z" });
      await future.upload();
      await future.accept();
      const at = await cutoff(control);
      await absent(() => seal(control, opened, at, [[f.product, future.after]], [future.row.id]), /STOCKTAKE_INTERVAL_UNRECONCILED/);
    } finally { await control.query("ROLLBACK TO SAVEPOINT future_effective_adjustment; RELEASE SAVEPOINT future_effective_adjustment"); }
    const adjustment = await f.sourceOperation({ ...correctionSource, at: beforeCorrection });
    await adjustment.upload();
    const admitted = await adjustment.accept();
    assert.equal(admitted.ok, true);
    const completeAt = await cutoff(control), counts = [[f.product, adjustment.after]];
    await absent(() => seal(control, opened, completeAt, counts, []), /STOCKTAKE_INTERVAL_UNRECONCILED/);
    await absent(() => seal(control, opened, completeAt, counts, [randomUUID()]), /STOCKTAKE_INTERVAL_UNRECONCILED/);
    await absent(() => seal(control, opened, beforeCorrection, counts, [adjustment.row.id]), /STOCKTAKE_INTERVAL_UNRECONCILED/);
    const sealed = await seal(control, opened, completeAt, counts, [adjustment.row.id]);
    assert.equal(sealed.corrections, 1);
    assert.deepEqual(await seal(control, opened, completeAt, counts, [adjustment.row.id]), sealed);
    await absent(() => seal(control, opened, completeAt, [[f.product, firstStock]], [adjustment.row.id]), /STOCKTAKE_REPLAY_CONFLICT/);
    pass("stocktake reconciles a genuine linked correction and rejects missing, foreign, late or future-effective receipts");

    const readback = JSON.parse(await read(control, "SELECT public.pos_stock_history_stocktake_for_review($1,$2,'A',$3)", [reviewer, f.terminal, id]));
    assert.deepEqual(readback.physicalCounts, counts);
    assert.deepEqual(readback.correctionMovements, [adjustment.row.id]);
    assert.equal(readback.evidenceHash, sealed.evidenceHash);
    await absent(() => review(f.admin, id, sealed.evidenceHash, []), /STOCKTAKE_INDEPENDENT_REVIEW_REQUIRED/);
    await absent(() => review(reviewer, id, opened.rosterHash, []), /STOCKTAKE_EVIDENCE_CHANGED/);
    const pending = await review(reviewer, id, sealed.evidenceHash, [oldFrontier]);
    assert.equal(pending.scopedPcPrefixesMatched, false);
    assert.equal(await read(control, "SELECT count(*) FROM private.stock_history_stocktake_reviews"), "0");
    const adjustmentHeader = JSON.parse(JSON.parse(adjustment.submission.sourceCohortJson).proofJson);
    const frontier = await acceptOpeningFrontier({ sourceSequence: "2", sourceRoot: adjustmentHeader.sourceRoot });
    const reviewed = await review(reviewer, id, sealed.evidenceHash, [frontier]);
    assert.deepEqual(await review(reviewer, id, sealed.evidenceHash, [frontier]), reviewed);
    assert.equal(reviewed.scopedPcPrefixesMatched, true);
    assert.equal(reviewed.effectiveOpeningEligible, false);
    assert.deepEqual(reviewed.reasons, ["STOCKTAKE_ALL_WRITER_BOUNDARY_UNPROVEN", "STOCKTAKE_PHYSICAL_CLOCK_UNVERIFIED"]);
    assert.equal(await read(control, "SELECT count(*) FROM public.stock_history_baselines"), "0");
    assert.equal(await read(control, "SELECT count(*) FROM public.stock_history_heads WHERE baseline_id IS NOT NULL"), "0");
    pass("a distinct scoped reviewer and genuine current PC prefix cannot certify all writers or the physical clock");
  } finally { await control.query("ROLLBACK"); }
  assert.equal(await f.stock(), firstStock);

  const started = await start(one, randomUUID()), at = await cutoff(one);
  await two.query(bind("UPDATE public.products SET name='Catalogue changed between stocktake snapshots' WHERE id=$1", [f.product]));
  await assert.rejects(seal(one, started, at, [[f.product, firstStock]], []), /STOCKTAKE_CATALOGUE_OR_COHORT_CHANGED/);
  assert.equal(await read(control, "SELECT count(*) FROM private.stock_history_stocktake_counts"), "0");
  assert.equal(await f.stock(), firstStock);
  pass("a separate committed writer invalidates the frozen stocktake roster without changing stock or publishing a balance");
};
