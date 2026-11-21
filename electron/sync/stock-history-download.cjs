const { createHash } = require("node:crypto");
const contract = require("../db/stock-history-contract.cjs");
const { stockHistoryUploadRow } = require("./stock-history-ack.cjs");

const MAX_PAGES = 256;
const MAX_ROWS = 100;
const MAX_PAGE_BYTES = 245760;
const MAX_WATERMARK_BYTES = 262144;
const MAX_PACKAGE_BYTES = 32 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 2 * MAX_WATERMARK_BYTES + 32768;
const PAGES_PER_PASS = 4;
const RETRY_AFTER = 30_000;
const MAX_INSTALL_WAIT = 1_000;
const HASH = /^[a-f0-9]{64}$/;
const MAX_CURSOR = 9223372036854775807n;
const sha256 = value => createHash("sha256").update(value, "utf8").digest("hex");
const fail = () => contract.fail("ESTOCK_HISTORY_DOWNLOAD_UNVERIFIED");
const uuid = value => typeof value === "string" && contract.identifier(value, true) === value;
const label = value => typeof value === "string" && !/[\x00-\x1f\x7f]/.test(value) && contract.identifier(value) === value;
const iso = value => typeof value === "string" && contract.canonicalInstant(value) === value;
const hash = value => typeof value === "string" && HASH.test(value);
const quantity = value => typeof value === "string" && String(contract.quantity(value)) === value;
const cursor = value => typeof value === "string" && /^(?:0|[1-9]\d{0,18})$/.test(value) && BigInt(value) <= MAX_CURSOR;
const ticks = value => typeof value === "string" && /^-?(?:0|[1-9]\d{0,19})$/.test(value) && String(BigInt(value)) === value;
const nullableText = value => value === null || typeof value === "string";
const fields = (value, keys) => value && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const tuple = (value, length) => Array.isArray(value) && value.length === length;
const envelope = ["ok", "version", "branchId", "terminalId", "projectOrigin"];
const scopeFields = ["branchId", "terminalId", "projectOrigin"];
const manifestFields = ["snapshotId", "revision", "headCursor", "coverageGeneration", "coverageState", "coverageFrom", "coverageThrough", "baseline", "pages"];

function checkScope(value, scope, keys) {
  if (!fields(value, [...envelope, ...keys]) || value.ok !== true || value.version !== 1 ||
    !scopeFields.every(key => value[key] === scope[key])) fail();
}

function checkManifest(response, scope) {
  const withdrew = response?.manifest === null && Object.hasOwn(response, "withdrawal");
  checkScope(response, scope, withdrew ? ["manifest", "withdrawal"] : ["manifest"]);
  if (response.manifest === null) {
    if (!withdrew) return null;
    if (!fields(response.withdrawal, ["coverageGeneration"]) || !cursor(response.withdrawal.coverageGeneration)) fail();
    return { withdrawal: response.withdrawal.coverageGeneration };
  }
  const manifest = response.manifest;
  if (!fields(manifest, manifestFields)) fail();
  const { snapshotId, revision, headCursor, coverageGeneration, coverageState, coverageFrom, coverageThrough, baseline, pages } = manifest;
  if (!uuid(snapshotId) || !hash(revision) || !cursor(headCursor) || !cursor(coverageGeneration) ||
      !["complete", "incomplete"].includes(coverageState) || !ticks(coverageFrom) || !ticks(coverageThrough) || BigInt(coverageThrough) < BigInt(coverageFrom) ||
      !tuple(baseline, 9) || !Array.isArray(pages) || pages.length > MAX_PAGES) fail();
  const [baselineId, cutoffAt, capturedAt, sourceCursor, kind, expectedPairs, verifiedBy, evidenceHash, watermarks] = baseline;
  if (!uuid(baselineId) || !iso(cutoffAt) || !iso(capturedAt) || capturedAt < cutoffAt || coverageFrom !== String(contract.instant(cutoffAt)) ||
      !cursor(sourceCursor) || BigInt(sourceCursor) > BigInt(headCursor) || !["system_snapshot", "physical_count"].includes(kind) ||
      !Number.isInteger(expectedPairs) || expectedPairs < 0 || !label(verifiedBy) || !hash(evidenceHash) ||
      typeof watermarks !== "string" || Buffer.byteLength(watermarks, "utf8") > MAX_WATERMARK_BYTES) fail();
  let parsed;
  try { parsed = JSON.parse(watermarks); } catch { fail(); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) fail();

  let openings = 0, movements = 0, sawMovement = false;
  for (const page of pages) {
    if (!tuple(page, 3) || !Number.isInteger(page[1]) || page[1] < 1 || page[1] > MAX_ROWS || !hash(page[2])) fail();
    if (page[0] === "openings" && !sawMovement) openings += page[1];
    else if (page[0] === "movements") { sawMovement = true; movements += page[1]; }
    else fail();
  }
  if (openings !== expectedPairs || BigInt(movements) !== BigInt(headCursor) - BigInt(sourceCursor)) fail();
  if (sha256(JSON.stringify([snapshotId, scope.projectOrigin, scope.branchId, scope.terminalId, headCursor, coverageGeneration,
    coverageState, coverageFrom, coverageThrough, baseline, pages])) !== revision) fail();
  return manifest;
}

function stockHistoryDownloadRequest(scope, manifest = null, index = 0) {
  return { version: 1, action: manifest ? "page" : "manifest", branchId: scope.branchId, terminalId: scope.terminalId,
    ...(manifest ? { snapshotId: manifest.snapshotId, revision: manifest.revision, index } : {}) };
}

function openingRow(value) {
  if (!tuple(value, 7)) fail();
  const [id, productId, openingQuantity, productName, sku, barcode, ownerStoreId] = value;
  if (!uuid(id) || !uuid(productId) || !quantity(openingQuantity) || typeof productName !== "string" ||
      !nullableText(sku) || !nullableText(barcode) || (ownerStoreId !== null && !label(ownerStoreId))) fail();
  return { id, productId, quantity: openingQuantity, productName, sku, barcode, ownerStoreId };
}

function movementRow(value, scope) {
  if (!tuple(value, 4)) fail();
  const [ingestedCursor, ingestedAt, payloadHash, payloadJson] = value;
  if (!cursor(ingestedCursor) || ingestedCursor === "0" || !iso(ingestedAt) || !hash(payloadHash) ||
    typeof payloadJson !== "string" || Buffer.byteLength(payloadJson, "utf8") > 126976 || sha256(payloadJson) !== payloadHash) fail();
  let payload;
  try { payload = JSON.parse(payloadJson); } catch { fail(); }
  if (!tuple(payload, 18) || payload[0] !== 1) fail();
  const [, id, operationId, productId, branch, terminalId, actorId, kind, delta, effectiveAt, effectiveTicks,
    recordedAt, productName, sku, barcode, clockState] = payload;
  if (branch !== scope.branchId || !label(terminalId) || (actorId !== null && !label(actorId)) ||
    !iso(effectiveAt) || !iso(recordedAt) || !quantity(delta)) fail();
  stockHistoryUploadRow({ id, operation_id: operationId, product_id: productId, store_id: branch, terminal_id: terminalId,
    actor_id: actorId, source_kind: kind, quantity_delta: delta, effective_at_raw: effectiveAt, effective_ticks: effectiveTicks,
    recorded_at_raw: recordedAt, product_name: productName, sku, barcode, clock_state: clockState,
    payload_hash: payloadHash, payload_json: payloadJson }, { branchId: branch, terminalId });
  return { id, operationId, productId, terminalId, actorId, kind, delta, effectiveAt, effectiveTicks,
    recordedAt, recordedTicks: String(contract.instant(recordedAt)), productName, sku, barcode, clockState,
    payloadHash, payloadJson, ingestedCursor, ingestedAt };
}

function beginDownload(manifest) {
  return { manifest, openings: [], movements: [], index: 0, bytes: 0, lastProduct: "", cursor: BigInt(manifest.baseline[3]),
    openingIds: new Set(), openingProducts: new Set(), movementIds: new Set(), legs: new Set() };
}

function appendPage(staged, response, scope) {
  checkScope(response, scope, ["snapshotId", "revision", "index", "kind", "rowsJson"]);
  const { manifest } = staged;
  const page = manifest.pages[staged.index];
  if (!page || response.snapshotId !== manifest.snapshotId || response.revision !== manifest.revision ||
    response.index !== staged.index || response.kind !== page[0] || typeof response.rowsJson !== "string") fail();
  const bytes = Buffer.byteLength(response.rowsJson, "utf8");
  if (bytes > MAX_PAGE_BYTES || staged.bytes + bytes > MAX_PACKAGE_BYTES || sha256(response.rowsJson) !== page[2]) fail();
  let rows;
  try { rows = JSON.parse(response.rowsJson); } catch { fail(); }
  if (!tuple(rows, page[1])) fail();
  for (const raw of rows) {
    if (page[0] === "openings") {
      const row = openingRow(raw);
      if (row.productId <= staged.lastProduct || staged.openingIds.has(row.id)) fail();
      staged.lastProduct = row.productId;
      staged.openingIds.add(row.id);
      staged.openingProducts.add(row.productId);
      staged.openings.push(row);
    } else {
      const row = movementRow(raw, scope);
      const leg = `${row.operationId}:${row.productId}`;
      if (BigInt(row.ingestedCursor) !== staged.cursor + 1n || staged.movementIds.has(row.id) || staged.legs.has(leg) ||
          !staged.openingProducts.has(row.productId) || (manifest.coverageState === "complete" &&
            (row.clockState !== "verified" || BigInt(row.effectiveTicks) <= BigInt(manifest.coverageFrom) ||
              BigInt(row.effectiveTicks) > BigInt(manifest.coverageThrough)))) fail();
      staged.cursor++;
      staged.movementIds.add(row.id);
      staged.legs.add(leg);
      staged.movements.push(row);
    }
  }
  staged.bytes += bytes;
  staged.index++;
}

function createStockHistoryDownloader({ request, current, install, withdraw, now = Date.now }) {
  let staged = null, nextAt = 0;
  return async (scope, assertCurrent, runInstall = work => work(assertCurrent)) => {
    if (now() < nextAt) return null;
    try {
      const manifestRead = () => request(stockHistoryDownloadRequest(scope));
      assertCurrent();
      const manifest = checkManifest(await manifestRead(), scope);
      assertCurrent();
      if (!manifest || manifest.withdrawal !== undefined) {
        staged = null;
        nextAt = now() + RETRY_AFTER;
        if (!manifest) return null;
        const checked = performance.now();
        return await runInstall(guard => {
          guard();
          if (performance.now() - checked > MAX_INSTALL_WAIT) fail();
          return withdraw(manifest.withdrawal, scope, guard);
        });
      }
      if (await current(manifest, scope, assertCurrent)) {
        staged = null;
        nextAt = now() + RETRY_AFTER;
        return null;
      }
      const sourceKey = JSON.stringify(scopeFields.map(key => scope[key]));
      if (!staged || staged.manifest.revision !== manifest.revision || staged.sourceKey !== sourceKey)
        staged = { ...beginDownload(manifest), sourceKey };
      for (let pages = 0; pages < PAGES_PER_PASS && staged.index < manifest.pages.length; pages++) {
        assertCurrent();
        const response = await request(stockHistoryDownloadRequest(scope, manifest, staged.index));
        assertCurrent();
        appendPage(staged, response, scope);
      }
      if (staged.index < manifest.pages.length) return null;
      const ready = staged;
      staged = null;
      const rechecked = checkManifest(await manifestRead(), scope);
      assertCurrent();
      if (rechecked?.revision !== manifest.revision || rechecked.snapshotId !== manifest.snapshotId ||
        rechecked.coverageGeneration !== manifest.coverageGeneration || ready.cursor !== BigInt(manifest.headCursor) ||
        ready.openings.length !== manifest.baseline[5]) fail();
      const checked = performance.now();
      const result = await runInstall(guard => {
        guard();
        if (performance.now() - checked > MAX_INSTALL_WAIT) fail();
        return install(ready, scope, guard);
      });
      nextAt = now() + RETRY_AFTER;
      return result;
    } catch (error) {
      staged = null;
      nextAt = now() + RETRY_AFTER;
      throw error;
    }
  };
}

module.exports = { checkManifest, beginDownload, appendPage, createStockHistoryDownloader, MAX_RESPONSE_BYTES };
