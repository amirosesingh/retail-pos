const assert = require("node:assert/strict");
const { createHash, generateKeyPairSync, randomUUID } = require("node:crypto");
const { readFileSync } = require("node:fs");

module.exports = async function stockCutover({ control, one, two, f, bind, pass, acceptOpeningFrontier }) {
  const { project, database } = f.stockSourceFixture;
  const marker = "CODEX-STOCK401-FIXTURE";
  const read = (session, sql, args = []) => session.query(bind(sql, args)).then(rows => Object.values(rows[0])[0]);
  const utc = "private.stock_history_cutover_utc";
  const rpc = async (sql, args) => JSON.parse(await read(control, `SELECT public.${sql}`, args));
  const reviewer = randomUUID(), id = randomUUID();
  const peer = { terminalId: randomUUID(), authorId: f.author, keyId: randomUUID(), pair: generateKeyPairSync("ed25519"),
    database: randomUUID(), sourceSequence: "0", sourceRoot: null };
  const witness = [f.admin, f.terminal, project, "A", id];
  const reviewerArgs = [reviewer, f.terminal, project, "A", id];
  const install = readFileSync("scripts/preparation/stock-history-stocktake-cutover.sql", "utf8");
  await control.query(`BEGIN;${install}COMMIT;`);
  const withReplica = process.env.STOCK_HISTORY_NATIVE_REPLICA_TEST === "1";
  if (withReplica) {
    assert.equal(process.platform, "win32");
    await control.query("ALTER TABLE public.terminal_tokens ADD COLUMN IF NOT EXISTS management_sync_enabled boolean;");
    await control.query(readFileSync("scripts/preparation/stock-history-replica-export.sql", "utf8"));
  }
  await control.query(bind(`ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS parent_id text,ADD COLUMN IF NOT EXISTS archived_at timestamptz,
      ADD COLUMN IF NOT EXISTS code text;
      ALTER TABLE public.terminal_tokens ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;
      UPDATE public.stores SET code=$1 WHERE id='A';
      INSERT INTO app_users(id,user_id,role,role_slug,permissions,is_active,store_id) VALUES($2::uuid,$2::text,'admin','admin','{}',true,'A');
      INSERT INTO public.terminal_tokens(id,location_id,platform,status,is_claimed,claimed_at) VALUES($3,'A','pc','used',true,clock_timestamp());
      INSERT INTO pos_sync_private.shift_author_keys(key_id,author_id,terminal_id,project_origin,subject,public_key) VALUES($4,$5,$3,$6,$5,$7);`,
    [marker, reviewer, peer.terminalId, peer.keyId, peer.authorId, project, peer.pair.publicKey.export({type:"spki",format:"der"}).toString("base64url")]));
  const configure = "SELECT private.stock_history_install_cutover_guard($1,'A',$2,$3::uuid[],$4::uuid[])";
  await assert.rejects(read(control, configure, [project, "B", `{${f.terminal}}`, `{${database}}`]), /STOCK_CUTOVER_SCOPE_INVALID/);
  await assert.rejects(read(control, configure, [project, marker, `{${f.terminal}}`, `{${database}}`]), /STOCK_CUTOVER_ROSTER_UNCONFIRMED/);
  await read(control, configure, [project, marker, `{${f.terminal},${peer.terminalId}}`, `{${database},${peer.database}}`]);
  assert.equal(await read(control, `SELECT has_function_privilege('service_role','private.stock_history_install_cutover_guard(text,text,text,uuid[],uuid[])','EXECUTE')`), "f");

  const prepare = (...args) => rpc("pos_stock_history_prepare_stocktake_pause($1,$2,$3,$4,$5)", args.length ? args : witness);
  const arm = proofs => rpc("pos_stock_history_arm_stocktake_pause($1,$2,$3,$4,$5,$6::jsonb)", [...witness, JSON.stringify(proofs)]);
  const release = () => rpc("pos_stock_history_release_stocktake_pause($1,$2,$3,$4,$5)", witness);
  const lease = await prepare();
  assert.deepEqual(await prepare(), lease);
  const loadLease = (purpose, physical = database) => rpc("pos_stock_history_load_stocktake_lease($1,$2,$3,$4,$5,$6,$7)",
    [...witness, physical, purpose]);
  const loadRelease = () => rpc("pos_stock_history_load_stocktake_release($1,$2,$3,$4,$5,$6)", [...witness,database]);
  assert.equal((await loadLease("arm")).databaseId,database);
  await assert.rejects(loadLease("arm",randomUUID()), /STOCK_CUTOVER_SCOPE_UNCONFIRMED/);
  await assert.rejects(loadLease("confirm"), /STOCK_CUTOVER_STOCKTAKE_REQUIRED/);
  await assert.rejects(loadRelease(), /STOCK_CUTOVER_RELEASE_UNCONFIRMED/);
  await assert.rejects(prepare(f.admin, f.terminal, "https://different.fixture", "A", id), /STOCK_CUTOVER_SCOPE_UNCONFIRMED/);
  await assert.rejects(two.query("UPDATE public.terminal_tokens SET revoked_at=clock_timestamp() WHERE location_id='A'"), /STOCK_CUTOVER_PAUSED/);
  await two.query("UPDATE public.terminal_tokens SET last_seen_at=clock_timestamp() WHERE location_id='A'");
  const localFencedAt = await read(control, `SELECT ${utc}(clock_timestamp())`);
  const localExpiresAt = await read(control, `SELECT ${utc}($1::timestamptz+interval '30 seconds')`, [lease.leaseExpiresAt]);
  const fenceGeneration = randomUUID();
  const proofBase = { terminalId: f.terminal, databaseId: database, fenceGeneration, localFencedAt, localExpiresAt };
  const peerBase = { ...proofBase, terminalId: peer.terminalId, databaseId: peer.database, fenceGeneration: randomUUID() };
  const signProof = async (phase, proof = proofBase, writer) => {
    let bound;
    const challengeId = await acceptOpeningFrontier(challenge => {
      bound = { ...proof, challengeId: challenge.challengeId };
      const gapHash = createHash("sha256").update(["stock401-pause-v1", phase, project, "A", id, bound.terminalId,
        bound.challengeId, bound.databaseId, bound.fenceGeneration, bound.localFencedAt, bound.localExpiresAt].join("\x1f")).digest("hex");
      return { gapHash };
    }, writer);
    assert.equal(bound.challengeId, challengeId);
    return bound;
  };
  const alien = { ...proofBase, challengeId: await acceptOpeningFrontier({}) };
  const peerArm = await signProof("arm", peerBase, peer);
  await assert.rejects(arm([alien, peerArm]), /STOCK_CUTOVER_PROOFS_UNCONFIRMED/);
  await one.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
  try {
    await read(one, "SELECT count(*) FROM public.products");
    const armProof = await signProof("arm");
    await assert.rejects(arm([armProof]), /STOCK_CUTOVER_ROSTER_UNCONFIRMED/);
    await two.query("BEGIN");
    try {
      await two.query(bind(`UPDATE public.products SET stock_by_store=jsonb_set(stock_by_store,'{A}','8') WHERE id=$1`, [f.product]));
      await assert.rejects(arm([armProof, peerArm]), error => error.code === "55P03");
    } finally { await two.query("ROLLBACK"); }
    const armed = await arm([armProof, peerArm]);
    assert.deepEqual(await arm([peerArm, armProof]), armed);
    // This transaction saw the unarmed lease. The physical gate row now has a
    // newer tuple, preventing its cached snapshot from allowing a stock write.
    await assert.rejects(one.query(bind(`UPDATE public.products SET stock_by_store=jsonb_set(stock_by_store,'{A}','8')
      WHERE id=$1`, [f.product])), error => error.code === "40001");
    pass("old repeatable-read snapshots and an unrelated signed prefix cannot bypass the real scoped pause gate");

    await assert.rejects(two.query(bind(`UPDATE public.products SET stock_by_store=jsonb_set(stock_by_store,'{A}','8')
      WHERE id=$1`, [f.product])), /STOCK_CUTOVER_PAUSED/);
    await two.query(bind(`UPDATE public.products SET stock_by_store=jsonb_set(stock_by_store,'{B}','1') WHERE id=$1`, [f.product]));
    assert.equal(await f.stock(), "7");
    assert.equal(await read(two, `SELECT stock_by_store->>'B' FROM public.products WHERE id=$1`, [f.product]), "1");
    pass("actual PostgreSQL stock, roster and unrelated-branch writes obey only the intended pause");

    await control.query("BEGIN");
    try {
      const sealed = await rpc("pos_stock_history_seal_stocktake($1,$2,$3,$4,$5,$6,$7::jsonb,'{}')", [f.admin, f.terminal, "A", id,
        armed.rosterHash, armed.cutoff, JSON.stringify([[f.product, "7"]])]);
      const publish = (proofs, subject = reviewer) => rpc("pos_stock_history_publish_stocktake($1,$2,$3,$4,$5,$6,$7::jsonb)", [subject,
        ...reviewerArgs.slice(1), sealed.evidenceHash, JSON.stringify(proofs)]);
      const denied = async (work, pattern) => {
        await control.query("SAVEPOINT cutover_case");
        try { await assert.rejects(work, pattern); }
        finally { await control.query("ROLLBACK TO SAVEPOINT cutover_case; RELEASE SAVEPOINT cutover_case"); }
      };
      await denied(() => publish([armProof, peerArm]), /STOCK_CUTOVER_PROOFS_UNCONFIRMED/);
      const peerConfirm = await signProof("confirm", peerBase, peer);
      const changed = await signProof("confirm", { ...proofBase, fenceGeneration: randomUUID() });
      await denied(() => publish([changed, peerConfirm]), /STOCK_CUTOVER_FENCE_CHANGED/);
      const confirmed = await signProof("confirm");
      await denied(() => publish([confirmed, peerConfirm], f.admin), /STOCKTAKE_INDEPENDENT_REVIEW_REQUIRED/);
      const publication = await publish([confirmed, peerConfirm]);
      assert.equal(publication.baselineId, id);
      assert.equal(publication.verificationState, "verified");
      assert.equal(publication.coverageFrom, armed.cutoff);
      assert.equal(publication.coverageThrough, armed.cutoff);
      assert.deepEqual(await publish([peerConfirm, confirmed]), publication);
      const quantities = JSON.parse(await read(control, `SELECT jsonb_build_array(b.opening_kind,b.verification_state,
        o.quantity::text,h.committed_cursor::text,h.coverage_from_ticks=h.coverage_through_ticks)
        FROM public.stock_history_baselines b JOIN public.stock_history_openings o ON o.baseline_id=b.id
        JOIN public.stock_history_heads h ON h.baseline_id=b.id WHERE b.id=$1`, [id]));
      assert.deepEqual(quantities, ["physical_count", "verified", "7", "1", true]);
      const exact = await rpc("pos_stock_history_page($1,$2,'A',$3,'UTC',NULL,100,NULL,false,NULL)", [reviewer, f.terminal, armed.cutoff]);
      assert.equal(exact.status, "complete");
      if (withReplica) {
        const { createLocal } = require("./lib/shift-protocol-integration-fixture.cjs");
        const { createStockHistoryDownloader } = require("../electron/sync/stock-history-download.cjs");
        const { createStockHistoryInstaller } = require("../electron/db/stock-history-download.cjs");
        const { StockHistoryStore } = require("../electron/db/stock-history.cjs");
        const local = await createLocal("A", { extraTables: ["products"] });
        try {
          const scope = { branchId: "A", projectOrigin: project, terminalId: f.terminal };
          const envelope = { ok: true, version: 1, ...scope };
          await local.manager.pool.request().batch(readFileSync("database/sqlserver/prepared/031_stock_history_effective_ledger.sql", "utf8"));
          const databaseGuid = (await local.manager.pool.request().query(
            "SELECT LOWER(CONVERT(varchar(36),database_guid)) guid FROM sys.database_recovery_status WHERE database_id=DB_ID();")).recordset[0].guid;
          const installer = createStockHistoryInstaller(local.manager, databaseGuid);
          const hash = text => createHash("sha256").update(text).digest("hex");
          let downloadedPages = 0;
          const download = createStockHistoryDownloader({ ...installer, request: async ({ action, index, snapshotId, revision }) => {
            if (action === "manifest") {
              const { manifest } = await rpc("pos_stock_history_replica_manifest('A',$1)", [f.terminal]);
              const { headCursor, coverageGeneration, coverageState, coverageFrom, coverageThrough, baseline, pages } = manifest;
              manifest.revision = hash(JSON.stringify([manifest.snapshotId, project, "A", f.terminal,
                headCursor, coverageGeneration, coverageState, coverageFrom, coverageThrough, baseline, pages]));
              return { ...envelope, manifest };
            }
            const { kind, rowsJson } = await rpc("pos_stock_history_replica_page('A',$1,$2,$3)", [f.terminal, snapshotId, index]);
            downloadedPages++;
            return { ...envelope, snapshotId, revision, index, kind, rowsJson };
          } });
          assert.equal(await download(scope, () => undefined), "installed");
          assert.equal(downloadedPages, 1);
          const native = new StockHistoryStore(local.manager, { authorizeRead: async () => ({
            branchId: "A", contextKey: "disposable-cutover", canViewInventory: true,
          }) });
          const report = await native.readPage({ cutoff: armed.cutoff, timeZone: "UTC" });
          assert.equal(report.status, "complete");
          assert.deepEqual(report.rows.map(row => [row.productId, row.quantity]), exact.rows.map(row => [row.productId, row.quantity]));
          assert.deepEqual(report.rows.map(row => row.quantity), ["7"]);
          pass("a real verified PostgreSQL opening downloads through the native installer and produces the exact SQL Server report");
        } finally { await local.close(); }
      }
      const after = await read(control, `SELECT ${utc}(clock_timestamp())`);
      const unsupportedAfter = await rpc("pos_stock_history_page($1,$2,'A',$3,'UTC',NULL,100,NULL,false,NULL)", [reviewer, f.terminal, after]);
      assert(unsupportedAfter.reasons.includes("INCOMPLETE_MOVEMENTS"));
      pass("immutable full physical count, independent review and same fresh fence publish exact coverage at one cutoff only");
    } finally { await control.query("ROLLBACK"); }
  } finally { await one.query("ROLLBACK"); }

  const released = await release();
  assert.deepEqual(await release(), released);
  assert.equal((await loadRelease()).releasedAt,released.releasedAt);
  await assert.rejects(prepare(), /STOCK_CUTOVER_LEASE_CLOSED/);
  await two.query(bind(`UPDATE public.products SET name='Released cutover fixture' WHERE id=$1`, [f.product]));
  const expiringId = randomUUID();
  await prepare(f.admin, f.terminal, project, "A", expiringId);
  // Test-only clock shift on this owned lease, keeping the database's exact
  // five-minute lifetime constraint. We do not wait five real minutes.
  await control.query(bind(`UPDATE private.stock_history_cutover_leases SET issued_at=issued_at-interval '6 minutes',
    expires_at=expires_at-interval '6 minutes' WHERE id=$1`, [expiringId]));
  await assert.rejects(prepare(f.admin, f.terminal, project, "A", expiringId), /STOCK_CUTOVER_LEASE_CLOSED/);
  await two.query(bind(`UPDATE public.products SET name='Expired cutover fixture' WHERE id=$1`, [f.product]));
  await two.query(bind(`DELETE FROM public.terminal_tokens WHERE id=$1`, [peer.terminalId]));
  assert.equal(await read(control, "SELECT count(*) FROM public.stock_history_baselines"), "0");
  pass("expiry and exact release restore ordinary writes and never reopen the same lease");
};
