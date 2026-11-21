const { pilotEnrollment, operationsScope } = require("./sync/grouped-store-settings.cjs");
const { recordId } = require("./sync/uuid-fields.cjs");
const { request, fail } = require("./sync/product-merge-command.cjs");
const { ProductMergeRepository } = require("./db/repositories/product-merge.cjs");
const { StockHistoryStore } = require("./db/stock-history.cjs");

function installedProductMergeEnrollment(env) {
  const value = env.POS_PRODUCT_MERGE_PILOT_ENROLLMENT;
  if (typeof value !== "string" || value.length > 1024) return null;
  try {
    const parsed = pilotEnrollment(JSON.parse(value));
    return parsed && Object.keys(parsed).length === 5 ? parsed : null;
  } catch { return null; }
}

function createProductMergeRuntime({ enrollment, manager, session, cloud, coordinator, ready }) {
  const active = pilotEnrollment(enrollment);
  const repository = active ? new ProductMergeRepository(manager, active.databaseGuid) : null;
  function permissions() {
    return session.hasPosAuthority() && (session.hasLevel("admin") ||
      (session.hasPermission("can_merge_products") && session.hasPermission("can_archive_product")));
  }
  function context(branch) {
    if (!active || branch !== active.branchId || !ready()) throw fail();
    if (!permissions()) throw fail("PERMISSION_DENIED");
    const identity = session.identity(), epoch = session.epoch(), source = cloud.requestContext(true);
    if (!identity?.authorId || operationsScope(source) !== branch || recordId(source.terminal.tokenId) !== active.terminalId ||
        source.base !== active.backendOrigin || source.project?.projectOrigin !== active.projectOrigin || source.pool !== manager.pool ||
        !["accessToken", "sessionToken", "cashierToken"].some(key => source.personProof?.[key])) throw fail();
    const scope = { authorId: recordId(identity.authorId), terminalId: active.terminalId,
      projectOrigin: active.projectOrigin, databaseGuid: active.databaseGuid };
    const guard = () => {
      if (session.epoch() !== epoch || !permissions() || recordId(session.identity()?.authorId) !== scope.authorId || !ready()) throw fail();
      cloud.assertRequestContext(source, true);
    };
    return { scope, guard, source };
  }
  async function checkStorage({ guard, source }) {
    const local = new StockHistoryStore(manager, { assertCurrent: guard, expectedDatabaseGuid: active.databaseGuid });
    if (!(await local.capability(source.pool)).available) throw fail();
    if (!(await repository.intentStorageReady(source.pool))) throw fail();
    guard();
  }
  async function checkCapability(branch, { guard, scope }) {
    const reply = await cloud.productMerge("capability", { version: 1, branchId: branch, terminalId: scope.terminalId });
    guard();
    if (reply?.ok !== true || reply.enabled !== true || Object.keys(reply).length !== 2) throw fail();
    return reply;
  }
  return {
    async capability(branch) {
      if (!active || branch !== active.branchId) return { ok: true, enabled: false };
      const bound = context(branch);
      await checkStorage(bound);
      return checkCapability(branch, bound);
    },
    async merge(input) {
      const branch = input?.branchId, normalized = request(input, branch);
      const bound = context(branch), { guard, scope } = bound;
      await checkStorage(bound);
      return coordinator.withExclusive(async () => {
        const checked = () => {
          guard();
          if (!coordinator.ownsExclusive() || coordinator.paused) throw fail();
        };
        const prepared = await repository.prepare(normalized, scope, checked, () => checkCapability(branch, bound));
        if (prepared.outcome) return prepared.outcome;
        const command = { ...prepared.request, terminalId: scope.terminalId };
        return repository.finish(prepared.request, scope, checked,
          () => cloud.productMerge("merge", command), () => cloud.productMerge("receipt", command));
      });
    },
  };
}

function registerProductMerge({ ipcMain, runtime, isPosSender, runWrite, publish }) {
  const fromPOS = (event, work) => Promise.resolve().then(() => {
    if (!isPosSender(event)) throw fail("PERMISSION_DENIED");
    return work();
  }).catch(error => {
    const code = /^(?:ESYNC_PRODUCT_MERGE_[A-Z_]+|PRODUCT_MERGE_[A-Z_]+|PERMISSION_DENIED)$/.test(error?.code ?? "")
      ? error.code : "ESYNC_PRODUCT_MERGE_UNVERIFIED";
    return { ok: false, code, error: "The product merge could not be verified. Check the saved merge after synchronization." };
  });
  ipcMain.handle("business:product-merge-capability", (event, input) => fromPOS(event, () => {
    if (!input || Object.keys(input).length !== 1 || typeof input.branchId !== "string") throw fail("ESYNC_PRODUCT_MERGE_INVALID");
    return runtime.capability(input.branchId);
  }));
  ipcMain.handle("business:merge-products", (event, input) => fromPOS(event, () => runWrite(async () => {
    const result = await runtime.merge(input);
    if (result.removed.length) publish({ kind: "product", branchId: result.branchId, source: "cloud", operationId: result.operationId,
      tables: ["products"], changes: [result.master, ...result.removed].map(row => ({ table: "products", entityId: row.id })) });
    return result;
  })));
}

module.exports = { installedProductMergeEnrollment, createProductMergeRuntime, registerProductMerge };
