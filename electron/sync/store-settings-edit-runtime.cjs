"use strict";

const { StoreSettingsEditOutbox } = require("../db/store-settings-edit-outbox.cjs");
const { assertStoreSettingsEditReceipt } = require("./cloud-client.cjs");
const grouped = require("./grouped-store-settings.cjs");
const handoff = require("./grouped-settings-handoff.cjs");
const { runStoreSettingsEditUpload } = require("./store-settings-edit-upload.cjs");
const { binding, sameBinding } = require("../verified-activation.cjs");

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const unavailable = () => grouped.fail("This till is not ready for offline store settings changes.", "ESETTINGS_EDIT_UNAVAILABLE");
const wrongActor = () => grouped.fail("Sign in with the authorized staff account to synchronize this edit.", "ESETTINGS_EDIT_OPERATOR");
const reviewChanged = () => grouped.fail("Download the latest verified store rules, then open the review again.", "ESETTINGS_REVIEW_CHANGED");
const captureMessages = {
  STALE_RULES: "The local store rules changed. Refresh the saved rules before trying again.",
  ESETTINGS_EDIT_INVALID: "This offline edit contains an unsupported value or setting.",
  ESETTINGS_EDIT_CONFLICT: "This edit ID already has different saved details. Refresh the store rules and try again.",
  ESETTINGS_EDIT_PENDING: "An earlier edit is waiting for confirmation or review. This draft is still open.",
  ESETTINGS_EDIT_OPERATOR: "Sign in with the authorized staff account before saving this draft offline.",
};

function createStoreSettingsEditRuntime({ pilot, installationGeneration, cloud, connectionManager, coordinator, ready, actor, registry }) {
  const enrollment = UUID.test(installationGeneration ?? "") ? pilot?.enrollment : null;
  let retryAfter = 0;
  let retryFingerprint;

  function currentOperator() {
    const user = actor();
    return UUID.test(user?.personId ?? "") && user.branchId === enrollment.branchId ? user : null;
  }

  function sourceContext() {
    if (!enrollment || !ready() || coordinator.paused) throw unavailable();
    const source = cloud.requestContext(false);
    const person = cloud.requestContext(true);
    const user = person.personProof?.accessToken ? currentOperator() : null;
    if (grouped.operationsScope(source) !== enrollment.branchId ||
        source.terminal.tokenId !== enrollment.terminalId || source.base !== enrollment.backendOrigin ||
        source.project.projectOrigin !== enrollment.projectOrigin || source.pool !== connectionManager.pool)
      throw unavailable();
    function assertCurrent() {
      if (!ready() || coordinator.paused) throw unavailable();
      const latest = person.personProof?.accessToken ? currentOperator() : null;
      if (latest?.epoch !== user?.epoch || latest?.personId !== user?.personId) throw wrongActor();
      cloud.assertRequestContext(source, false);
      cloud.assertRequestContext(person, true);
    }
    return { source, person, user, branch: enrollment.branchId, databaseGuid: enrollment.databaseGuid,
      projection: enrollment.projection, assertCurrent };
  }

  async function verifiedPosition(request, context, locked) {
    context.assertCurrent();
    if (await grouped.readDatabaseGuid(request()) !== context.databaseGuid) throw unavailable();
    handoff.assertGroupedFence(await handoff.readFence(request(), context.branch, locked), context);
    const position = await grouped.readPosition(request(), context, locked);
    if (!position) throw unavailable();
    context.assertCurrent();
    return position;
  }

  async function outboxFor(request, context, locked) {
    const { epoch } = await verifiedPosition(request, context, locked);
    return new StoreSettingsEditOutbox({
      connectionManager,
      scope: { ...enrollment, feedEpoch: epoch, installationGeneration },
      assertContext: async (tx, scope, personId) => {
        if (personId !== (context.user?.personId ?? null)) return false;
        return (await verifiedPosition(() => tx.request(), context, true)).epoch === scope.feedEpoch;
      },
      assertReceipt: assertStoreSettingsEditReceipt,
    });
  }

  async function capture(input) {
    try {
      return await coordinator.withExclusive(async () => {
        if (pilot?.mode !== "run") throw unavailable();
        const context = sourceContext();
        if (input.branchId !== context.branch) throw unavailable();
        if (!context.user) throw wrongActor();
        const sql = connectionManager.sql();
        const tx = new sql.Transaction(context.source.pool);
        await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
        try {
          const outbox = await outboxFor(() => tx.request(), context, true);
          const command = await outbox.capture(tx, { ...input, personId: context.user.personId });
          context.assertCurrent();
          await tx.commit();
          retryAfter = 0;
          return { ok: true, operationId: command.operationId };
        } catch (error) {
          await Promise.resolve(tx.rollback()).catch(() => undefined);
          throw error;
        }
      });
    } catch (error) {
      const code = Object.hasOwn(captureMessages, error?.code) ? error.code : "ESETTINGS_EDIT_UNAVAILABLE";
      return { ok: false, code, error: captureMessages[code] ?? "Offline save is unavailable on this till. Your draft is still open." };
    }
  }

  async function verifyReviewActor(context) {
    const { source, person, user, branch } = context;
    const response = await fetch(`${source.base}/api/v1/pos/ipc-adopt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accessToken: person.personProof.accessToken, terminalToken: source.terminal.tokenId,
        deviceBindingProof: source.terminal.deviceBindingProof }),
      signal: AbortSignal.timeout(8_000),
      redirect: "error",
    });
    const { boundedText } = await import("./shift-recovery-exact.mjs");
    const result = JSON.parse(await boundedText(response, 16_384));
    if (response.status === 401 || response.status === 403) throw wrongActor();
    if (!response.ok) throw unavailable();
    if (result?.ok !== true || result.settingsPersonId !== user.personId || result.branchId !== branch ||
        !sameBinding(binding(source.terminal), result.terminal) ||
        (result.level !== "admin" && result.permissions?.can_access_pos_settings !== true)) throw wrongActor();
    context.assertCurrent();
  }

  async function review(input) {
    try {
      const context = sourceContext();
      if (input.branchId !== context.branch) throw unavailable();
      if (!context.user) throw wrongActor();
      const table = registry?.tables.find(row => row.cloudTable === grouped.TABLE && row.sqlServerTable === grouped.TABLE);
      if (!table) throw unavailable();
      await verifyReviewActor(context);
      const response = await cloud.groupedSettingsSnapshot(context.source, context.projection);
      const snapshot = grouped.settingsFromSnapshot(response, context.branch, table, context.projection);
      context.assertCurrent();
      return await coordinator.withExclusive(async () => {
        context.assertCurrent();
        const sql = connectionManager.sql();
        const tx = new sql.Transaction(context.source.pool);
        await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
        try {
          const outbox = await outboxFor(() => tx.request(), context, true);
          const local = await grouped.readLocalRow(tx, table, snapshot.change, "store_id", context.branch);
          if (local?.matching !== 1 || outbox.scope.feedEpoch !== snapshot.epoch || snapshot.expires <= Date.now())
            throw reviewChanged();
          const decision = await outbox.review(tx, { ...input, personId: context.user.personId, canonical: snapshot.change.row_data });
          context.assertCurrent();
          if (snapshot.expires <= Date.now()) throw reviewChanged();
          if (input.operationId && !decision) throw reviewChanged();
          await tx.commit();
          return { ok: true, ...(input.operationId ? decision : { review: decision }) };
        } catch (error) {
          await Promise.resolve(tx.rollback()).catch(() => undefined);
          throw error;
        }
      });
    } catch (error) {
      const code = error?.code;
      if (code === "ESETTINGS_REVIEW_CHANGED") return { ok: false, code, error: reviewChanged().message };
      if (code === "ESETTINGS_EDIT_OPERATOR" || code === "ESETTINGS_EDIT_SCOPE")
        return { ok: false, code: "ESETTINGS_EDIT_OPERATOR", error: "Sign in with the original authorized staff account to review this edit." };
      return { ok: false, code: "ESETTINGS_REVIEW_UNAVAILABLE",
        error: "The settings review could not be verified and saved. Check the connection and review again." };
    }
  }

  async function upload() {
    if (!enrollment || pilot?.mode !== "run") return null;
    const outcome = (status, reason = null) => ({ status, reason, branchId: enrollment.branchId });
    return coordinator.withExclusive(async () => {
      if (coordinator.paused) return outcome("PAUSED");
      let context;
      try {
        context = sourceContext();
        if (retryFingerprint === context.person.fingerprint && Date.now() < retryAfter) return outcome("RETRY");
        const outbox = await outboxFor(() => context.source.pool.request(), context, false);
        const result = await runStoreSettingsEditUpload({ coordinator, connectionManager, outbox, cloud, personId: context.user?.personId ?? null });
        return outcome(result.status);
      } catch (error) {
        switch (error?.code) {
          case "ESETTINGS_EDIT_OPERATOR":
            return outcome("AWAITING_OPERATOR");
          case "SETTINGS_EDIT_FORBIDDEN":
          case "ESETTINGS_EDIT_SCOPE":
          case "ESETTINGS_EDIT_INVALID":
          case "ESETTINGS_EDIT_RECEIPT":
            return outcome("REVIEW_REQUIRED");
          case "ESYNC_GROUPED_HANDOFF_REQUIRED":
          case "ESETTINGS_EDIT_UNAVAILABLE":
            return outcome("UNAVAILABLE");
          default:
            retryFingerprint = context?.person.fingerprint;
            retryAfter = Date.now() + 60_000;
            return outcome("RETRY", "ESETTINGS_EDIT_RETRY");
        }
      }
    });
  }

  return { capture, upload, review };
}

module.exports = { createStoreSettingsEditRuntime };
