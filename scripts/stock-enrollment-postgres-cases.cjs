const assert = require("node:assert/strict");
const { createHash, generateKeyPairSync, randomUUID, sign, verify } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { stockCoverageFrontierJson } = require("../electron/shared/stock-coverage-frontier.mjs");
const { stockCoverageFrontierMessage } = require("../electron/security/stock-event-author-protocol.cjs");

module.exports = async function stockEnrollment({ control, f, bind, pass }) {
  const { project } = f.stockSourceFixture;
  const previous = "codex-stock401-111abc", branch = "codex-stock401-222def";
  const cluster = id => id.replace("codex-stock401-", "codex-stock401-cluster-");
  const read = async (sql, args = []) => Object.values((await control.query(bind(sql, args)))[0])[0];
  const json = async (sql, args) => JSON.parse(await read(sql, args));
  await control.query("BEGIN");
  try {
    await control.query(readFileSync("scripts/preparation/stock-history-stocktake-cutover.sql", "utf8"));
    await control.query(`ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS parent_id text,
      ADD COLUMN IF NOT EXISTS archived_at timestamptz,ADD COLUMN IF NOT EXISTS code text;
      ALTER TABLE public.terminal_tokens ADD COLUMN IF NOT EXISTS management_sync_enabled boolean;`);
    const registrations = [];
    for (const store of [previous, branch]) {
      await control.query(bind(`INSERT INTO public.stores(id,code,name,group_id,private_catalogue,is_active)
        VALUES($1,$2,'Owned enrollment fixture',$3,true,true);`, [store, store.toUpperCase(), cluster(store)]));
      const till = [];
      for (let counter = 0; counter < 2; counter++) {
        const terminalId = randomUUID(), databaseId = randomUUID(), authorId = randomUUID(), keyId = randomUUID();
        const pair = generateKeyPairSync("ed25519");
        await control.query(bind(`INSERT INTO public.terminal_tokens(id,location_id,platform,status,is_claimed,claimed_at)
          VALUES($1,$2,'pc','used',true,clock_timestamp());
          INSERT INTO public.app_users(id,user_id,role,role_slug,permissions,is_active,store_id)
          VALUES($3::uuid,$3,'admin','admin','{}',true,$2);
          INSERT INTO pos_sync_private.shift_author_keys(key_id,author_id,terminal_id,project_origin,subject,public_key)
          VALUES($4,$3,$1,$5,$3,$6);`, [terminalId, store, authorId, keyId, project,
          pair.publicKey.export({ type: "spki", format: "der" }).toString("base64url")]));
        till.push({ ids: { terminalId, databaseId, authorId }, keyId, pair });
      }
      registrations.push(till);
    }
    const [oldTills, newTills] = registrations;
    const cohort = newTills.map(witness => witness.ids);
    await read("SELECT private.stock_history_install_cutover_guard($1,$2,$3,$4::uuid[],$5::uuid[])",
      [project, previous, previous.toUpperCase(), `{${oldTills.map(w => w.ids.terminalId)}}`, `{${oldTills.map(w => w.ids.databaseId)}}`]);
    await control.query(readFileSync("scripts/preparation/stock-history-stocktake-enrollment.sql", "utf8"));
    const signature = "public.pos_stock_history_enroll_stocktake_till(text,text,text,text,text,text,jsonb,uuid,uuid)";
    assert.equal(await read("SELECT has_function_privilege('authenticated',$1,'EXECUTE')", [signature]), "f");
    assert.equal(await read("SELECT has_function_privilege('service_role',$1,'EXECUTE')", [signature]), "t");
    assert.equal(await read("SELECT count(*) FROM private.stock_history_pilot_enrollment_receipts"), "0");
    assert.equal(await read("SELECT private.stock_history_cutover_guard_ready($1,$2)", [previous, cluster(previous)]), "t");

    async function acceptedObservation(witness) {
      const { terminalId, databaseId, authorId } = witness.ids;
      const challengeId = randomUUID(), keyId = witness.keyId;
      const challenge = await json("SELECT public.pos_stock_history_frontier_challenge($1,$2,$3,$4,$5,$6)",
        [challengeId, project, branch, terminalId, authorId, keyId]);
      const raw = stockCoverageFrontierJson({ version: 1, projectOrigin: project, branchId: branch, terminalId,
        authorId, databaseId, challengeId, nonce: challenge.nonce, cohortHash: challenge.cohortHash,
        writerRevision: "stock-history-source.v1", sourceSequence: "0", sourceRoot: null, sourceGeneration: "a".repeat(64),
        gapHash: "b".repeat(64), pending: { business: "0", metadata: "0", unsigned: "0", unknown: "0" },
        observedAt: challenge.issuedAt });
      const fields = { version: 1, algorithm: "Ed25519", keyId, projectOrigin: project, terminalId, authorId,
        subject: authorId, branchId: branch, challengeId, frontierHash: createHash("sha256").update(raw).digest("hex") };
      const message = Buffer.from(stockCoverageFrontierMessage(fields));
      const signed = sign(null, message, witness.pair.privateKey);
      assert(verify(null, message, witness.pair.publicKey, signed));
      const receipt = await json("SELECT public.pos_stock_history_accept_frontier($1,$2,$3,$4,$5,true)",
        [project, branch, terminalId, raw, JSON.stringify({ ...fields, signature: signed.toString("base64url") })]);
      assert.equal(receipt.state, "accepted");
      return challengeId;
    }
    const enroll = (till, proof, selected = cohort) => json(
      "SELECT public.pos_stock_history_enroll_stocktake_till($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)",
      [till.authorId, till.terminalId, project, branch, previous, branch.toUpperCase(), JSON.stringify(selected), till.databaseId, proof]);
    const denied = async (work, expected) => {
      await control.query("SAVEPOINT enrollment_denial");
      try { await assert.rejects(work, expected); }
      finally { await control.query("ROLLBACK TO SAVEPOINT enrollment_denial; RELEASE SAVEPOINT enrollment_denial"); }
    };

    const proofA = await acceptedObservation(newTills[0]);
    const proofB = await acceptedObservation(newTills[1]);
    await denied(() => enroll(cohort[0], proofB), /STOCK_CUTOVER_ENROLLMENT_PROOF_REQUIRED/);
    await denied(() => enroll({ ...cohort[0], databaseId: cohort[1].databaseId }, proofA), /STOCK_CUTOVER_SCOPE_DENIED/);
    assert.deepEqual(await enroll(cohort[0], proofA), { projectOrigin: project, branchId: branch,
      terminalId: cohort[0].terminalId, databaseId: cohort[0].databaseId, cohortReady: false });
    assert.equal(await read("SELECT private.stock_history_cutover_guard_ready($1,$2)", [branch, cluster(branch)]), "f");
    assert.equal(await read("SELECT count(*) FROM private.stock_history_pilot_enrollment_receipts"), "1");
    pass("hosted enrollment requires the authenticated till’s exact accepted proof and leaves the prior guard intact after one receipt");

    const altered = [{ ...cohort[0], databaseId: randomUUID() }, cohort[1]];
    await denied(() => enroll(cohort[1], proofB, altered), /STOCK_CUTOVER_ENROLLMENT_CONFLICT/);
    await denied(async () => {
      await control.query(bind("UPDATE public.app_users SET role='staff',role_slug='staff' WHERE id=$1", [cohort[0].authorId]));
      await enroll(cohort[1], proofB);
    }, /STOCK_CUTOVER_ROSTER_UNCONFIRMED/);
    assert.equal(await read("SELECT private.stock_history_cutover_guard_ready($1,$2)", [previous, cluster(previous)]), "t");
    assert.equal((await enroll(cohort[1], proofB, [...cohort].reverse())).cohortReady, true);
    assert.equal((await enroll(cohort[0], await acceptedObservation(newTills[0]))).cohortReady, true);
    assert.equal(await read("SELECT private.stock_history_cutover_guard_ready($1,$2)", [branch, cluster(branch)]), "t");
    assert.equal(await read("SELECT private.stock_history_cutover_guard_ready($1,$2)", [previous, cluster(previous)]), "f");
    assert.equal(await read("SELECT count(*) FROM private.stock_history_cutover_scope WHERE retired_at IS NOT NULL"), "1");
    assert.equal(await read("SELECT count(*) FROM private.stock_history_cutover_enrollment"), "4");
    assert.equal(await read("SELECT count(*) FROM private.stock_history_pilot_enrollment_receipts"), "2");
    assert.equal(await read("SELECT count(*) FROM private.stock_history_cutover_leases"), "0");
    assert.equal(await f.stock(), "7");
    pass("two matching app enrollments replace only the unused pilot guard and replay after a lost reply without new receipts or stock writes");
  } finally {
    await control.query("ROLLBACK");
  }
};
