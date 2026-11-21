const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

module.exports = async function openingObservations({ control, one, two, f, bind, pass, pause, header, acceptOpeningFrontier }) {
  const read = (session, sql) => session.query(sql).then(rows => Object.values(rows[0])[0]);
  const plan = async () => JSON.parse(await read(control, bind(
    "SELECT public.pos_stock_history_opening_plan($1,$2,'A')", [f.admin, f.terminal])));
  const observe = (session, id, candidate) => read(session, bind(
    "SELECT public.pos_stock_history_publish_opening($1,$2,'A',$3,$4,'Reviewed observed stock')",
    [f.admin, f.terminal, id, candidate.candidateHash]));

  const observationId = randomUUID(), first = await plan();
  await one.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
  await assert.rejects(observe(one, observationId, first), /STOCK_OPENING_OBSERVATION_ISOLATION_REQUIRED/);
  await one.query("ROLLBACK");
  pass("an inherited repeatable-read snapshot cannot use later observation timestamps");

  // A writer commits after the first candidate and before the comparison read.
  // The owned trigger establishes the schedule without timing a stock query.
  const lock = 52100401, backend = await read(one, "SELECT pg_backend_pid()");
  await control.query(`CREATE FUNCTION private.opening_fixture_pause() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN PERFORM pg_advisory_xact_lock(${lock}); RETURN NEW; END $$;
    CREATE TRIGGER opening_fixture_pause AFTER INSERT ON public.stock_history_openings
    FOR EACH ROW EXECUTE FUNCTION private.opening_fixture_pause();
    SELECT pg_advisory_lock(${lock});`);
  const pending = observe(one, observationId, first).then(() => null, error => error);
  try {
    let waiting = false;
    for (let attempt = 0; attempt < 30 && !waiting; attempt++) {
      waiting = await read(control, `SELECT count(*) FROM pg_locks WHERE pid=${backend} AND locktype='advisory' AND NOT granted`) === "1";
      if (!waiting) await pause(20);
    }
    assert.equal(waiting, true, "observation must wait at the explicit fixture barrier");
    await two.query(bind("UPDATE public.products SET name='Concurrent observed catalogue' WHERE id=$1", [f.product]));
  } finally { await control.query(`SELECT pg_advisory_unlock(${lock});`); }
  assert.match((await pending)?.message ?? "", /STOCK_OPENING_SOURCE_CHANGED/);
  assert.equal(await read(control, "SELECT count(*) FROM public.stock_history_baselines"), "0");
  await control.query("DROP TRIGGER opening_fixture_pause ON public.stock_history_openings; DROP FUNCTION private.opening_fixture_pause();");
  pass("a commit between the two candidate reads rejects the entire observation");

  await observe(control, observationId, await plan());
  const cutoff = "2026-11-06T01:02:03.1234567Z";
  const eligibility = async (at, receipts) => JSON.parse(await read(control, bind(
    "SELECT private.stock_history_opening_eligibility($1,$2,$3,'A',$4,$5,$6::uuid[])",
    [f.admin, f.terminal, f.stockSourceFixture.project, observationId, at, `{${receipts.join(",")}}`])));
  const observedFrontier = await acceptOpeningFrontier({});
  const absent = await eligibility(cutoff, []);
  assert.equal(absent.scopedPcRosterMatched, false);
  assert.equal(absent.observedEffectsAttested, false);
  await assert.rejects(eligibility(cutoff, [observedFrontier, observedFrontier]), /STOCK_OPENING_EVIDENCE_INVALID/);
  const equal = await eligibility(cutoff, [observedFrontier]);
  const future = await eligibility("2026-11-06T01:02:03.1234566Z", [observedFrontier]);
  assert.equal(equal.scopedPcRosterMatched, true);
  assert.equal(equal.observedEffectsAttested, true);
  assert.equal(equal.includedFutureEffectiveMovements, false);
  assert.equal(future.includedFutureEffectiveMovements, true);
  assert.equal(future.unverifiedMovementClock, true);
  assert.equal(future.allWriterCoverageProven, false);
  assert.equal(equal.effectiveOpeningEligible, false);
  pass("real signed frontier and exact stock effect identify a future-effective movement one tick before its own instant");

  await control.query(bind("BEGIN; INSERT INTO public.terminal_tokens(id,location_id,platform,status,is_claimed,revoked_at) VALUES($1,'A','pc','used',true,clock_timestamp())", [randomUUID()]));
  try { assert.equal((await eligibility(cutoff, [observedFrontier])).scopedPcRosterMatched, false); }
  finally { await control.query("ROLLBACK"); }
  const late = await f.sourceOperation({ sourceSequence: "2", sourcePredecessorRoot: header.sourceRoot });
  await late.upload();
  await late.accept();
  const lateHeader = JSON.parse(JSON.parse(late.submission.sourceCohortJson).proofJson);
  const latest = await acceptOpeningFrontier({ sourceSequence: "2", sourceRoot: lateHeader.sourceRoot });
  assert.equal((await eligibility(cutoff, [observedFrontier])).scopedPcRosterMatched, false);
  const delayed = await eligibility(cutoff, [latest]);
  assert.equal(delayed.observedEffectsAttested, true);
  assert.equal(delayed.lateEffectiveMovements, true);
  assert.equal(delayed.effectiveOpeningEligible, false);
  pass("a genuine late accepted effect at the inclusive boundary and a changed/retired roster cannot certify opening");

  // A business commit after the final candidate can still proceed. It does not
  // change the earlier recorded row or publish an exact historical cutoff.
  const concurrentId = randomUUID();
  const candidate = await plan();
  const oldStock = await f.stock();
  await one.query("BEGIN");
  const observation = JSON.parse(await observe(one, concurrentId, candidate));
  await two.query(bind("UPDATE public.products SET stock_by_store=jsonb_set(stock_by_store,'{A}',to_jsonb($2::integer)) WHERE id=$1",
    [f.product, Number(oldStock) - 1]));
  await one.query("COMMIT");
  assert.equal(await f.stock(), String(Number(oldStock) - 1));
  assert.equal(await read(control, bind("SELECT quantity::text FROM public.stock_history_openings WHERE baseline_id=$1", [concurrentId])), oldStock);
  assert.equal(await read(control, "SELECT count(*) FROM public.stock_history_heads WHERE baseline_id IS NOT NULL"), "0");
  assert.equal(await read(control, "SELECT count(*) FROM public.stock_history_baselines WHERE verification_state='verified'"), "0");
  assert.equal(observation.effectiveOpeningEligible, false);
  assert.deepEqual(JSON.parse(await observe(two, concurrentId, candidate)), observation);
  pass("a stock writer after the final candidate does not block or turn the observation into a historical opening");
};
