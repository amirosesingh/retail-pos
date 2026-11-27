const assert = require("node:assert/strict");
const { createHash, randomUUID } = require("node:crypto");

module.exports = async function financialPilot({ control, bind, pass, read, json, denied, project, branch,
  newTills, acceptedObservation }) {
  const hash = fields => createHash("sha256").update(fields.join("\x1f")).digest("hex");
  const [witness, reviewer] = newTills.map(till => till.ids);
  const id = randomUUID(), product = randomUUID();
  const signature = "public.pos_stock_history_approve_financial_till(text,text,text,text,uuid,uuid)";
  const approve = (till, proof) => json("SELECT public.pos_stock_history_approve_financial_till($1,$2,$3,$4,$5,$6)",
    [till.authorId, till.terminalId, project, branch, till.databaseId, proof]);
  const properProof = till => acceptedObservation(till, challengeId => hash([
    "stock401-financial-approval-v1", project, branch, till.ids.terminalId, till.ids.databaseId, challengeId,
  ]));
  const capability = till => json("SELECT public.pos_sync_financial_capability('default',$1,$2,NULL)", [branch, till.terminalId]);
  assert.equal(await read("SELECT has_function_privilege('authenticated',$1,'EXECUTE')", [signature]), "f");
  assert.equal(await read("SELECT has_function_privilege('service_role',$1,'EXECUTE')", [signature]), "t");
  assert.equal(await read("SELECT count(*) FROM private.stock_history_financial_pilot_confirmations"), "0");
  assert.equal(await read("SELECT count(*) FROM fin62_rollout_preparation.approvals"), "0");
  assert.deepEqual(await json("SELECT public.pos_live_financial_ready()"), { ready: true, version: 2 });
  await denied(async () => approve(witness, await properProof(newTills[0])), /STOCK_CUTOVER_FINANCIAL_OPENING_REQUIRED/);

  // Fixture-only established stock before any enrollment can authorize a sale.
  await control.query(bind(`ALTER TABLE public.products DISABLE TRIGGER stock_history_accepted_products;
   INSERT INTO public.products(id,name,barcode,owner_store_id,stock_by_store,stock_quantity)
   VALUES($1,'Protected finite stock',concat('protected-',left($1,12)),$2,jsonb_build_object($2,7),7);
   ALTER TABLE public.products ENABLE TRIGGER stock_history_accepted_products;`, [product, branch]));
  const opening = await json("SELECT public.pos_stock_history_prepare_stocktake_pause($1,$2,$3,$4,$5)",
    [witness.authorId, witness.terminalId, project, branch, id]);
  const bounds = await json(`SELECT jsonb_build_array(private.stock_history_cutover_utc(clock_timestamp()),
    private.stock_history_cutover_utc($1::timestamptz+interval '30 seconds'))`, [opening.leaseExpiresAt]);
  const fences = [witness, reviewer].map(till => ({ terminalId: till.terminalId, databaseId: till.databaseId,
    fenceGeneration: randomUUID(), localFencedAt: bounds[0], localExpiresAt: bounds[1] }));
  const claims = async phase => {
    const result = [];
    for (const [index, till] of newTills.entries()) {
      const fence = fences[index];
      const challengeId = await acceptedObservation(till, challengeId => hash([
        "stock401-pause-v1", phase, project, branch, id, fence.terminalId, challengeId, fence.databaseId,
        fence.fenceGeneration, fence.localFencedAt, fence.localExpiresAt,
      ]));
      result.push({ ...fence, challengeId });
    }
    return result;
  };
  const armed = await json("SELECT public.pos_stock_history_arm_stocktake_pause($1,$2,$3,$4,$5,$6::jsonb)",
    [witness.authorId, witness.terminalId, project, branch, id, JSON.stringify(await claims("arm"))]);
  const sealed = await json("SELECT public.pos_stock_history_seal_stocktake($1,$2,$3,$4,$5,$6,$7::jsonb,'{}'::uuid[])",
    [witness.authorId, witness.terminalId, branch, id, armed.rosterHash, armed.cutoff, JSON.stringify([[product, "7"]])]);
  await json("SELECT public.pos_stock_history_publish_stocktake($1,$2,$3,$4,$5,$6,$7::jsonb)",
    [reviewer.authorId, reviewer.terminalId, project, branch, id, sealed.evidenceHash, JSON.stringify(await claims("confirm"))]);
  await denied(async () => approve(witness, await properProof(newTills[0])), /STOCK_CUTOVER_SCOPE_UNCONFIRMED/);
  await json("SELECT public.pos_stock_history_release_stocktake_pause($1,$2,$3,$4,$5)",
    [witness.authorId, witness.terminalId, project, branch, id]);
  const ordinary = await acceptedObservation(newTills[0]);
  const a = await properProof(newTills[0]), b = await properProof(newTills[1]);
  await denied(() => approve(witness, ordinary), /STOCK_CUTOVER_FINANCIAL_PROOF_REQUIRED/);
  await denied(() => approve(witness, b), /STOCK_CUTOVER_FINANCIAL_PROOF_REQUIRED/);
  await denied(async () => {
    await control.query("ALTER FUNCTION public.pos_sync_financial_capability(text,text,text,uuid) COST 101");
    await approve(witness, a);
  }, /STOCK_CUTOVER_FINANCIAL_READINESS_REQUIRED/);
  await denied(async () => {
    await control.query(bind(`SET LOCAL pos.shift_fn='on';
      INSERT INTO public.shifts(id,store_id,terminal_id,status,state,opening_float,row_version,opened_at)
        VALUES($1,$2,$3,'OPEN','ACTIVE',0,1,clock_timestamp());`, [randomUUID(), branch, witness.terminalId]));
    await approve(witness, a);
  }, /STOCK_CUTOVER_FINANCIAL_BRANCH_USED/);
  assert.equal((await approve(witness, a)).cohortReady, false);
  assert.equal((await approve(witness, a)).cohortReady, false);
  assert.equal((await capability(witness)).mode, "disabled");
  assert.equal((await capability(reviewer)).mode, "disabled");
  assert.equal(await read("SELECT count(*) FROM private.stock_history_financial_pilot_confirmations"), "1");
  pass("financial activation requires a released physical opening, the domain-bound exact till proof, intact FIN62 and no sales or shifts");

  await denied(async () => {
    await control.query(bind(`INSERT INTO fin62_rollout_preparation.approvals(organization_id,branch_id,terminal_id,revision,rollout_id,status)
        VALUES('default',$1,$2,1,$3,'revoked')`, [branch, witness.terminalId, randomUUID()]));
    await approve(reviewer, b);
  }, /STOCK_CUTOVER_FINANCIAL_ROLLOUT_CONFLICT/);
  assert.equal((await approve(reviewer, b)).cohortReady, true);
  const active = await capability(witness);
  assert.equal(active.mode, "required");
  assert.equal((await capability(reviewer)).rolloutId, active.rolloutId);
  assert.equal((await approve(witness, await properProof(newTills[0]))).cohortReady, true);
  assert.equal(await read("SELECT count(*) FROM private.stock_history_financial_pilot_confirmations"), "2");
  assert.equal(await read("SELECT count(*) FROM private.stock_history_financial_pilot_rollouts"), "1");
  assert.equal(await read("SELECT count(*) FROM fin62_rollout_preparation.approvals"), "2");
  await denied(async () => {
    await control.query(bind(`INSERT INTO fin62_rollout_preparation.approvals(organization_id,branch_id,terminal_id,revision,rollout_id,status)
        VALUES('default',$1,$2,2,$3,'revoked')`, [branch, witness.terminalId, active.rolloutId]));
    await approve(witness, a);
  }, /STOCK_CUTOVER_FINANCIAL_ROLLOUT_CONFLICT/);
  assert.equal(await read("SELECT stock_quantity FROM public.products WHERE id=$1", [product]), "7");
  assert.equal(await read("SELECT count(*) FROM public.shifts WHERE store_id=$1", [branch]), "0");
  assert.equal(await read("SELECT count(*) FROM public.sales WHERE store_id=$1", [branch]), "0");
  pass("two distinct application confirmations activate one protected rollout atomically and preserve earlier revocations and exact retries");
};
