"use strict";

const { StockHistoryStore } = require("./db/stock-history.cjs");
const { StockHistoryOutbox } = require("./db/stock-history-outbox.cjs");
const { createStockHistoryInstaller } = require("./db/stock-history-download.cjs");
const { createStockHistoryDownloader } = require("./sync/stock-history-download.cjs");
const { StockHistoryUploader } = require("./sync/stock-history-uploader.cjs");
const { StockEventAuthority } = require("./stock-event-authority.cjs");
const { createStockCoverageFrontierRuntime } = require("./stock-coverage-frontier-runtime.cjs");
const { operationsScope, pilotEnrollment } = require("./sync/grouped-store-settings.cjs");
const { recordId } = require("./sync/uuid-fields.cjs");
const { fail } = require("./db/stock-history-contract.cjs");

const table = "stock_history_movements";
const unsignedErrors = new Set([
  "PERMISSION_DENIED", "ESTOCK_AUTHOR_INVALID", "ESYNC_SHIFT_AUTHOR_IDENTITY_PENDING", "ESYNC_SHIFT_AUTHOR_SETUP_PENDING",
  "ESYNC_SHIFT_AUTHOR_ENROLLMENT_PENDING", "ESYNC_SHIFT_AUTHOR_KEY_MISSING", "ESYNC_SHIFT_AUTHOR_KEY_UNAVAILABLE",
  "ESYNC_SHIFT_AUTHOR_VAULT_UNAVAILABLE", "ESYNC_SHIFT_AUTHOR_KEY_MISMATCH", "ESTOCK_AUTHOR_PERMISSION_REVOKED",
]);

function installedStockHistoryEnrollment(env) {
  const raw = env.POS_STOCK_HISTORY_PILOT_ENROLLMENT;
  if (typeof raw !== "string" || raw.length > 1024) return null;
  try {
    const value = pilotEnrollment(JSON.parse(raw));
    return value && Object.keys(value).length === 5 ? value : null;
  } catch { return null; }
}

function supportedAction(kind, operations) {
  if (kind === "stock" && operations.some(op => op.table === "stock_adjustments")) return "ADJUST";
  if (kind === "receiving" && operations.some(op => op.table === "purchase_orders")) return "RECEIVE";
  if (kind === "product" && operations.some(op => op.table === "products" && ["insert", "upsert"].includes(op.kind)))
    return "PRODUCT_CREATE";
  return null;
}

function createStockHistoryRuntime({ enrollment, manager, cloud, keys, session, terminal, branch, project, ready, stocktakeBackend }) {
  const active = pilotEnrollment(enrollment);
  const sourceContext = () => {
    if (!active || !ready()) return null;
    try {
      const source = cloud.requestContext(false);
      if (operationsScope(source) !== active.branchId || recordId(source.terminal.tokenId) !== active.terminalId ||
          source.base !== active.backendOrigin || source.project.projectOrigin !== active.projectOrigin || source.pool !== manager.pool)
        return null;
      return source;
    } catch { return null; }
  };
  const sourceGuard = source => () => {
    const current = sourceContext();
    if (!current || current.pool !== source.pool || current.fingerprint !== source.fingerprint)
      fail("ESTOCK_HISTORY_CONTEXT_CHANGED");
    cloud.assertRequestContext(source, false);
  };

  const authority = active ? new StockEventAuthority({
    keys, session, connectionManager: manager, terminal, project, branch, context: () => sourceContext()?.fingerprint,
  }) : null;

  async function prepareAuthor(action, transaction) {
    if (!action || !session.identity()?.authorId) return null;
    try { return await authority.prepare(authority.capture(action), transaction); }
    catch (error) {
      if (unsignedErrors.has(error?.code)) return null;
      throw error;
    }
  }

  const capture = active ? new StockHistoryStore(manager, {
    expectedDatabaseGuid: active.databaseGuid,
    canCapture: () => Boolean(sourceContext()),
    // ReceiptRepository uses this only as the original terminal hint. The
    // transaction separately rechecks source and actor before any evidence.
    readContext: () => sourceContext() ? { terminalId: active.terminalId } : null,
    prepareWrite: async (tx, operations, input) => {
      const source = sourceContext();
      if (!source || recordId(input.branchId) !== active.branchId || recordId(input.terminalId) !== active.terminalId) return null;
      const assertSource = sourceGuard(source);
      const actor = session.identity(), epoch = session.epoch();
      const authorId = actor?.source === "pos" && (!actor.branchId || recordId(actor.branchId) === active.branchId)
        ? recordId(actor.authorId) || null : null;
      const assertCurrent = () => {
        assertSource();
        const current = session.identity();
        if (session.epoch() !== epoch || current?.authorId !== actor?.authorId || current?.canonicalSubject !== actor?.canonicalSubject)
          fail("ESTOCK_HISTORY_CONTEXT_CHANGED");
      };
      const refundAuthor = input.kind === "refund" ? input.refundStockAuthor : null;
      const protectedRefund = refundAuthor?.action === "REFUND" && refundAuthor.operationId === input.operationId &&
        refundAuthor.projectOrigin === active.projectOrigin && refundAuthor.terminalId === active.terminalId &&
        refundAuthor.branchId === active.branchId && refundAuthor.authorId === authorId && refundAuthor.subject === actor?.canonicalSubject;
      const directAction = input.kind === "sale" && input.groupedCashOrigin === true ? "SALE" : protectedRefund ? "REFUND" : null;
      const action = directAction ?? supportedAction(input.kind, operations);
      const prepared = authorId ? await prepareAuthor(action, tx) : null;
      const author = !protectedRefund || prepared?.keyId === refundAuthor.keyId ? prepared : null;
      assertCurrent();
      return { key: source.fingerprint, branchId: active.branchId, terminalId: active.terminalId, actorId: authorId,
        clockState: "unverified", assertCurrent, author, writerKnown: Boolean(action) && (!protectedRefund || Boolean(author)),
        requireSourceManifests: directAction === null };
    },
  }) : null;
  let currentUploader;
  function scopedUploader(branchId, terminalId) {
    if (!active || recordId(branchId) !== active.branchId || recordId(terminalId) !== active.terminalId) return null;
    const source = sourceContext();
    if (!source) return null;
    if (currentUploader?.source.pool === source.pool && currentUploader.source.fingerprint === source.fingerprint)
      return currentUploader.uploader;
    const assertCurrent = sourceGuard(source);
    const outbox = new StockHistoryOutbox(manager, { assertCurrent, expectedDatabaseGuid: active.databaseGuid });
    const uploader = new StockHistoryUploader({ outbox, cloud, assertCurrent });
    currentUploader = { source, uploader };
    return uploader;
  }

  const pendingSourceAcks = new WeakMap();
  const routeUnavailable = () => ({ held: { code: "ESTOCK_HISTORY_ROUTE_UNAVAILABLE", fresh: false,
    message: "Stock history is outside the verified pilot connection. Saved evidence remains pending." } });
  const uploader = {
    accepts: aggregate => aggregate?.changes?.some(change => change.entity_type === table) === true,
    async prepareBusiness(operationId, branchId, terminalId, batchId) {
      const route = scopedUploader(branchId, terminalId);
      const batch = await route?.prepareBusiness(operationId, branchId, terminalId, batchId);
      if (batch) pendingSourceAcks.set(batch, route);
      return batch ?? null;
    },
    async acknowledgeBusiness(batch, response) {
      const route = pendingSourceAcks.get(batch);
      if (!route) return;
      pendingSourceAcks.delete(batch);
      await route.acknowledgeBusiness(batch, response);
    },
    async reviewHeldCount(remaining, branchId, terminalId) {
      return await scopedUploader(branchId, terminalId)?.reviewHeldCount(remaining, branchId, terminalId) ?? 0;
    },
    async upload(aggregate, branchId, terminalId) {
      if (!this.accepts(aggregate) || aggregate.originals || aggregate.changes.some(change => change.entity_type !== table))
        fail("ESTOCK_HISTORY_ACK_UNCONFIRMED");
      const route = scopedUploader(branchId, terminalId);
      if (!route) return routeUnavailable();
      try { return await route.upload(aggregate, branchId, terminalId); }
      catch (error) {
        if (error?.code === "ESTOCK_HISTORY_SCHEMA_UNAVAILABLE" || error?.code === "ESTOCK_HISTORY_CONTEXT_CHANGED")
          return routeUnavailable();
        throw error;
      }
    },
  };

  const frontier = active ? createStockCoverageFrontierRuntime({
    manager, keys, session, terminal, branch, project, cloud, expectedDatabaseGuid: active.databaseGuid,
    context: () => sourceContext()?.fingerprint,
    stocktakeBackend,
  }) : null;
  const downloader = active ? createStockHistoryDownloader({
    ...createStockHistoryInstaller(manager, active.databaseGuid), request: input => cloud.downloadStockHistory(input),
  }) : null;
  let downloading = null;

  return Object.freeze({
    capture, uploader,
    async stocktake(action, request) {
      if (!frontier?.stocktake || !sourceContext() || !session.hasLevel("admin")) fail("ESTOCK_STOCKTAKE_UNAVAILABLE");
      if (action === "arm") return frontier.stocktake.arm(request);
      if (action === "prove") return frontier.stocktake.prove(request);
      if (action === "release") return frontier.stocktake.release(request);
      fail("ESTOCK_STOCKTAKE_INVALID");
    },
    async captureReady({ pool, branchId, terminalId, authorId }) {
      const source = sourceContext();
      if (!source || source.pool !== pool || active.branchId !== recordId(branchId) || active.terminalId !== recordId(terminalId) ||
          recordId(session.identity()?.authorId) !== recordId(authorId)) return false;
      const assertCurrent = sourceGuard(source);
      const store = new StockHistoryStore(manager, { assertCurrent, expectedDatabaseGuid: active.databaseGuid });
      if (!(await store.capability(pool)).available) return false;
      const author = await prepareAuthor("RECEIVE");
      assertCurrent();
      return Boolean(author);
    },
    async observe({ branchId, assertLease }) {
      if (!frontier || active.branchId !== branchId || !session.hasPosAuthority() || assertLease() !== true) return;
      const source = sourceContext();
      if (!source) return;
      const store = new StockHistoryStore(manager, { assertCurrent: sourceGuard(source), expectedDatabaseGuid: active.databaseGuid });
      if (!(await store.capability(source.pool)).available) return;
      return frontier.run({ assertLease: () => assertLease() === true && sourceContext()?.fingerprint === source.fingerprint });
    },
    download({ branchId, runInstall }) {
      if (!downloader || active.branchId !== branchId || downloading || !session.hasPosAuthority()) return;
      const source = sourceContext();
      if (!source) return;
      const assertSource = sourceGuard(source), epoch = session.epoch();
      const guard = () => {
        assertSource();
        if (session.epoch() !== epoch || !session.hasPosAuthority()) fail("ESTOCK_HISTORY_CONTEXT_CHANGED");
      };
      const scope = { branchId, terminalId: active.terminalId, projectOrigin: active.projectOrigin };
      downloading = downloader(scope, guard, work => runInstall(assertLease => work(() => {
        guard();
        if (assertLease() !== true) fail("ESTOCK_HISTORY_CONTEXT_CHANGED");
      }))).finally(() => { downloading = null; });
      return downloading;
    },
  });
}

module.exports = { installedStockHistoryEnrollment, createStockHistoryRuntime };
