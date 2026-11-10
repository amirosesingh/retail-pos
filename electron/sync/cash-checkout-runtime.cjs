const { AggregateRepository } = require("../db/repositories/aggregates.cjs");
const { SaleEventOutbox } = require("../db/sale-event-outbox.cjs");
const { checkedCashBridgeScope } = require("../db/sale-cash-wire.cjs");
const { operationsScope, pilotEnrollment, MIXED_PROJECTION } = require("./grouped-store-settings.cjs");
const { recordId } = require("./uuid-fields.cjs");
const route = require("./cash-checkout-route.cjs");

function cashSenderEnrollment(env) {
  const raw = env.POS_GROUPED_CASH_SENDER_ENROLLMENT;
  if (typeof raw !== "string" || raw.length > 1024) return null;
  try {
    const { installationGeneration, feedEpoch, ...pilot } = JSON.parse(raw);
    const enrollment = pilotEnrollment(pilot);
    if (!enrollment || enrollment.projection !== MIXED_PROJECTION) return null;
    const scope = checkedCashBridgeScope({ ...enrollment, installationGeneration, feedEpoch });
    if (scope.feedEpoch !== feedEpoch || scope.installationGeneration !== installationGeneration) return null;
    return Object.freeze({ enrollment, scope, allowExtendedTenders: enrollment.extended === true &&
      env.POS_GROUPED_TENDER_UPLOAD_PILOT_ENABLED === "true" });
  } catch { return null; }
}

function isCashCandidate(kind, aggregate, allowExtendedTenders) {
  if (kind !== "sale" || aggregate.managementDevice || aggregate.operations.length !== route.TABLES.length) return false;
  const byTable = new Map(aggregate.operations.map(operation => [operation.table, operation]));
  const product = byTable.get("products");
  const rows = table => {
    const operation = byTable.get(table);
    if (!operation || !["insert", "upsert"].includes(operation.kind)) return [];
    return operation.rows ?? (operation.values ? [operation.values] : []);
  };
  const sale = rows("sales")[0];
  const tenders = rows("payment_transactions");
  const eligibleTender = (tenders.length === 1 && sale?.payment_type === "cash") ||
    (allowExtendedTenders && tenders.length > 0 && tenders.length <= 16 &&
      tenders.some(row => row.method === "card") && tenders.every(row => ["cash", "card"].includes(row.method)));
  return product?.kind === "update" && product.match?.id && eligibleTender && Boolean(sale?.shift_id) &&
    route.TABLES.filter(table => !["products", "payment_transactions"].includes(table)).every(table => rows(table).length === 1);
}

function createCashCheckoutRuntime({ configured, cloud, connectionManager, registry, coordinator, ready, handoff, authority }) {
  async function admit(writingNew = true) {
    if (!configured || !ready() || !coordinator.ownsExclusive() || coordinator.paused) return null;
    const { enrollment, scope } = configured;
    const source = cloud.requestContext(false);
    let branchId;
    try { branchId = operationsScope(source); }
    catch (error) {
      if (error?.code === "ESYNC_GROUPED_SCOPE") return null;
      throw error;
    }
    if (branchId !== scope.branchId || recordId(source.terminal.tokenId) !== scope.terminalId ||
        source.base !== enrollment.backendOrigin || source.project.projectOrigin !== enrollment.projectOrigin ||
        source.pool !== connectionManager.pool) return null;
    const assertCurrent = () => {
      if (!ready() || coordinator.paused || !coordinator.ownsExclusive()) throw route.fail();
      cloud.assertRequestContext(source, false);
    };
    if (await handoff({ source, ...scope, writingNew }) !== true) return null;
    assertCurrent();
    return { source, scope, assertCurrent };
  }

  async function commit(legacy, kind, aggregate, assertRequestCurrent = () => {}) {
    if (!configured || !isCashCandidate(kind, aggregate, configured.allowExtendedTenders)) return legacy.commit(kind, aggregate);
    return coordinator.withExclusive(async () => {
      const legacyCommit = () => { assertRequestCurrent(); return legacy.commit(kind, aggregate); };
      assertRequestCurrent();
      const active = await admit();
      if (!active || active.scope.branchId !== recordId(aggregate.branchId) || active.scope.terminalId !== recordId(aggregate.terminalId))
        return legacyCommit();
      let author;
      try {
        assertRequestCurrent();
        author = await authority.prepare(authority.captureCashCheckout());
      } catch (error) {
        if (["ESYNC_SHIFT_AUTHOR_SETUP_PENDING", "ESYNC_SHIFT_AUTHOR_ENROLLMENT_PENDING",
          "ESYNC_SHIFT_AUTHOR_IDENTITY_PENDING", "PERMISSION_DENIED"].includes(error?.code)) return legacyCommit();
        throw error;
      }
      const assertCurrent = () => { assertRequestCurrent(); active.assertCurrent(); author.assertCurrent(); };
      const outbox = new SaleEventOutbox(connectionManager, registry, { cashBridge: active.scope, installedHandoff: true,
        allowExtendedTenders: configured.allowExtendedTenders,
        prepareCashAuthor: () => ({ assertCurrent, signCashCheckout: author.signCashCheckout }) });
      const repository = new AggregateRepository(connectionManager, legacy.operationsRepository, { saleOutbox: outbox });
      assertCurrent();
      try { return await repository.commit(kind, aggregate); }
      catch (error) {
        if (error?.code !== "ESALE_CASH_LEGACY_ONLY") throw error;
        assertCurrent();
        return legacyCommit();
      }
    });
  }

  async function upload(wire) {
    const active = await admit(false);
    if (!active || Object.entries(active.scope).some(([key, value]) => wire.scope[key] !== value))
      return route.uploadHold("ESYNC_CASH_HANDOFF_REQUIRED");
    const response = await cloud.submitCashCheckout(active.source, wire);
    if (["WAITING_DEPENDENCY", "REVIEW_REQUIRED", "INTEGRITY_CONFLICT", "IN_PROGRESS"].includes(response?.status))
      return route.uploadHold(response.status);
    const outbox = new SaleEventOutbox(connectionManager, registry, { cashBridge: active.scope });
    await outbox.recordBridgeAcceptance(wire, response, active.assertCurrent, true);
    return true;
  }

  return { admit, commit, upload };
}

module.exports = { cashSenderEnrollment, createCashCheckoutRuntime };
