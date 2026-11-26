const assert = require("node:assert/strict");
const { createHash, randomUUID } = require("node:crypto");
const contract = require("../electron/db/stock-history-contract.cjs");
const { StockHistoryStore } = require("../electron/db/stock-history.cjs");
const { createStockHistoryInstaller } = require("../electron/db/stock-history-download.cjs");
const { createStockHistoryDownloader } = require("../electron/sync/stock-history-download.cjs");
const { createManagementStockHistory } = require("../electron/sync/management-stock-history.cjs");
const { createStockHistoryReader } = require("../electron/stock-history-ipc.cjs");

module.exports = async function stockHistoryDownloadCases({ pool, sql, inTx, pass }) {
  const manager = { pool, sql: () => sql };
  const at = "2026-11-09T00:00:00.1234567Z", through = "2026-11-10T00:00:00.7654321Z";
  const scope = { branchId: "replica-fixture", terminalId: randomUUID(), projectOrigin: "https://replica.fixture" };
  const product = { id: randomUUID(), name: "Fixture 📦", stock_by_store: { [scope.branchId]: "9007199254740993" } };
  const opening = [randomUUID(), product.id, "9007199254740993", product.name, null, "00040", scope.branchId];
  const selectedBaseline = [randomUUID(), at, at, "7", "physical_count", 1, "reviewer", "a".repeat(64), "{}"];
  const envelope = { ...scope, ok: true, version: 1 };
  const hash = value => createHash("sha256").update(value).digest("hex");
  const movement = (terminalId = randomUUID()) => contract.changes(contract.normalizeContext({ operationId: randomUUID(),
    branchId: scope.branchId, terminalId, actorId: randomUUID(), kind: "stock", clockState: "verified", effectiveAt: through }, through),
    [product], [{ ...product, stock_by_store: { [scope.branchId]: "9007199254740994" } }])[0];
  const remote = movement();
  const databaseGuid = (await pool.request().query("SELECT LOWER(CONVERT(nvarchar(36),database_guid)) guid FROM sys.database_recovery_status WHERE database_id=DB_ID();")).recordset[0].guid;
  const installer = createStockHistoryInstaller(manager, databaseGuid);
  const store = new StockHistoryStore(manager, { authorizeRead: async () => ({ branchId: scope.branchId, contextKey: "download-fixture", canViewInventory: true }) });
  const query = (text, value) => pool.request().input("branch", scope.branchId).input("value", value ?? null).query(text);
  const state = async () => (await query(`SELECT (SELECT * FROM dbo.stock_history_heads WHERE store_id=@branch FOR JSON PATH) head,
   (SELECT * FROM dbo.stock_history_baselines WHERE store_id=@branch ORDER BY id FOR JSON PATH) baseline,
   (SELECT * FROM dbo.stock_history_openings WHERE store_id=@branch ORDER BY id FOR JSON PATH) openings,
   (SELECT * FROM dbo.stock_history_movements WHERE store_id=@branch ORDER BY id FOR JSON PATH) movements,
   (SELECT * FROM dbo.sync_change_journal WHERE branch_id=@branch ORDER BY change_id FOR JSON PATH) journal,
   (SELECT * FROM dbo.products ORDER BY id FOR JSON PATH) business;`)).recordset[0];
  const noChange = async action => {
    const before = await state();
    await assert.rejects(action);
    assert.deepEqual(await state(), before);
  };
  const payload = (cursor, row) => [cursor, through, row.payload_hash, row.payload_json];
  const replica = { tokenId: scope.terminalId, deviceUse: "management", deviceType: "pc" };
  const receive = (generation, headCursor, selectedOpening, selectedRows, baseline = selectedBaseline, coverageState = "complete", changes, management = false) => {
    const chunks = [["openings", JSON.stringify([selectedOpening])], ["movements", JSON.stringify(selectedRows)]];
    const manifest = { snapshotId: randomUUID(), headCursor, coverageGeneration: generation, coverageState,
      coverageFrom: String(contract.instant(baseline[1])), coverageThrough: String(contract.instant(through)), baseline,
      pages: chunks.map(([kind, raw]) => [kind, JSON.parse(raw).length, hash(raw)]),
    };
    manifest.revision = hash(JSON.stringify([manifest.snapshotId, scope.projectOrigin, scope.branchId, scope.terminalId,
      manifest.headCursor, manifest.coverageGeneration, manifest.coverageState, manifest.coverageFrom, manifest.coverageThrough, manifest.baseline, manifest.pages]));
    const response = { ...envelope, manifest };
    const request = async ({ action, index, branchId, terminalId }) => {
      assert.equal(branchId, scope.branchId);
      assert.equal(terminalId, scope.terminalId);
      if (action === "manifest") return response;
      return { ...envelope, snapshotId: manifest.snapshotId, revision: manifest.revision, index,
        kind: chunks[index][0], rowsJson: changes?.(chunks[index][1]) ?? chunks[index][1] };
    };
    if (management) {
      const source = { pool, fingerprint: "fixture-profile", stamp: "fixture-branches",
        branches: [scope.branchId], terminal: replica, project: { projectOrigin: scope.projectOrigin } };
      return createManagementStockHistory({ manager, ready: () => true, cloud: {
        verifiedManagementStockScope: () => source, downloadStockHistory: request,
      } })(work => work(() => true));
    }
    const run = createStockHistoryDownloader({ ...installer, request });
    return run(scope, () => undefined);
  };
  const before = await state();
  assert.equal(await receive("11", "8", opening, [payload("8", remote)], undefined, undefined, undefined, true), "installed");
  const loaded = await store.readPage({ cutoff: through, timeZone: "Asia/Brunei" });
  assert.equal(loaded.status, "complete", JSON.stringify(loaded));
  assert.equal(loaded.rows[0].quantity, "9007199254740994");
  const imported = await state();
  assert.equal(imported.business, before.business);
  assert.equal(imported.journal, before.journal);
  assert.equal(JSON.parse(imported.movements)[0].ingested_cursor, 8);
  pass("owned download installs pinned opening and accepted cursor atomically with exact SQL quantity and original bytes");

  const reopenManagementReader = (projectOrigin = scope.projectOrigin, terminalId = scope.terminalId) => {
    const admission = { branchId: scope.branchId, contextKey: "new-session", projectOrigin, terminalId, canViewInventory: true };
    return createStockHistoryReader({ manager, session: { hasPosAuthority: () => true, epoch: () => 1, identity: () => null, touch: () => {} },
      terminal: () => replica, branch: () => null, isPosSender: () => true,
      managementHistoryAdmission: async () => ({ ...admission, assertCurrent: () => {},
        authorizeRead: async () => admission }) });
  };
  const managementRequest = { cutoff: through, branchId: scope.branchId, timeZone: "Asia/Brunei" };
  const reopened = await reopenManagementReader()(null, managementRequest);
  assert.equal(reopened.page.status, "complete");
  assert.equal(reopened.page.rows[0].quantity, "9007199254740994");
  const wrongReceiver = await reopenManagementReader("https://other.fixture")(null, managementRequest);
  assert.equal(wrongReceiver.page.status, "unavailable");
  assert.deepEqual(wrongReceiver.page.rows, []);
  pass("a new Management reader loads only its receiving terminal's stored stock history without any cloud request");
  const { readStockHistoryFrontierSnapshot } = require("../electron/db/stock-history-frontier-snapshot.cjs");
  const observation = await readStockHistoryFrontierSnapshot({ manager, branchId: scope.branchId, terminalId: scope.terminalId,
    assertCurrent: () => undefined, assertLease: () => true });
  assert.equal(observation.available, true, JSON.stringify(observation));
  assert.equal(observation.pending.unsigned, "0");
  assert.equal(observation.pending.metadata, "0");
  pass("downloaded accepted rows do not manufacture unsigned local frontier debt or outbound claims");

  const pending = movement(scope.terminalId);
  await inTx(async tx => store.insertMovements(tx, scope.branchId, [{ ...pending, author_proof_json: '{"fixture":"original"}' }]));
  const localSaved = await state();
  const anotherRemote = movement();
  assert.equal(await receive("12", "9", opening, [payload("8", remote), payload("9", anotherRemote)]), "installed");
  const retained = await state();
  const original = JSON.parse(localSaved.movements).find(row => row.id.toLowerCase() === pending.id);
  assert.equal(original.author_proof_json, '{"fixture":"original"}');
  assert.deepEqual(JSON.parse(retained.movements).find(row => row.id.toLowerCase() === pending.id), original);
  assert.equal(retained.journal, localSaved.journal);
  const report = await store.readPage({ cutoff: through, timeZone: "Asia/Brunei" });
  assert(report.reasons.includes("PENDING_UPLOADS"));
  const newOpening = [randomUUID(), ...opening.slice(1)], newBaseline = [randomUUID(), at, at, "9", ...selectedBaseline.slice(4)];
  await noChange(() => receive("13", "10", newOpening, [payload("10", pending)], newBaseline));
  await noChange(() => receive("13", "9", [...opening.slice(0, 2), "4", ...opening.slice(3)], [payload("8", remote), payload("9", anotherRemote)]));
  await noChange(() => receive("13", "9", opening, [payload("8", remote), payload("9", anotherRemote)], selectedBaseline, "complete", raw => raw + " "));
  pass("pending journal bytes survive a replica advance; pending overlap, immutable row conflict, and corrupt chunks roll back");

  assert.equal(await installer.withdraw("13", scope, () => undefined), "withdrawn");
  const revoked = await state();
  assert.equal(JSON.parse(revoked.head)[0].coverage_state, "incomplete");
  assert.equal(revoked.baseline, retained.baseline);
  assert.equal(revoked.movements, retained.movements);
  await noChange(() => receive("12", "9", opening, [payload("8", remote), payload("9", anotherRemote)]));
  await noChange(() => installer.withdraw("14", { ...scope, projectOrigin: "https://different.fixture" }, () => undefined));
  pass("authoritative withdrawal fences stale coverage without removing report or business evidence");

  const newerCutoff = "2026-11-09T02:00:00.1234567Z", newerOpening = [randomUUID(), ...opening.slice(1)];
  const newerBaseline = [randomUUID(), newerCutoff, newerCutoff, "8", ...selectedBaseline.slice(4)];
  assert.equal(await receive("14", "9", newerOpening, [payload("9", anotherRemote)], newerBaseline), "installed");
  const olderDate = await store.readPage({ cutoff: "2026-11-09T01:00:00.1234567Z", timeZone: "Asia/Brunei" });
  assert.equal(olderDate.status, "unsupported");
  assert(olderDate.reasons.includes("BEFORE_BASELINE"));
  assert.equal(JSON.parse((await state()).baseline).length, 2);
  pass("the downloaded head selects only its certified opening while retaining the earlier immutable rows");
};
