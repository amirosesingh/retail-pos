"use strict";

const { createHash } = require("node:crypto");
const { readDatabaseGuid } = require("../sync/grouped-store-settings.cjs");
const { recordId } = require("../sync/uuid-fields.cjs");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DRAWER_LIMIT = /^(0|[1-9][0-9]{0,25})(\.[0-9]{1,12})?$/;
const POSITIVE_SEQUENCE = /^[1-9][0-9]{0,18}$/;
const MAX_SEQUENCE = 9223372036854775807n;
const COMMAND_COLUMNS = "c.operation_id,c.branch_id,c.terminal_id,c.command_json,c.command_sha256,r.disposition,r.receipt_json";

function refuse(code, message) {
  throw Object.assign(new Error(message), { code, table: "pos_store_settings" });
}

const invalid = () => refuse("ESETTINGS_EDIT_INVALID", "The settings edit evidence is invalid.");
const wrongScope = () => refuse("ESETTINGS_EDIT_SCOPE", "The current settings editor or installation could not be verified.");
const badReceipt = () => refuse("ESETTINGS_EDIT_RECEIPT", "The settings edit acceptance could not be verified.");
const pending = () => refuse("ESETTINGS_EDIT_PENDING", "An earlier settings edit still requires confirmation or review.");
const hash = value => createHash("sha256").update(value, "utf8").digest("hex");
const plain = value => value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;

function uuid(value) {
  if (typeof value !== "string" || !UUID.test(value)) invalid();
  return recordId(value);
}

function scopeOf(input) {
  const { branchId, terminalId, installationGeneration, databaseGuid, feedEpoch } = input ?? {};
  if (typeof branchId !== "string" || !branchId || branchId !== branchId.trim() || branchId.length > 128 ||
      /[\x00-\x1f]/.test(branchId) || Buffer.byteLength(branchId, "utf8") > 256) invalid();
  return Object.freeze({ organizationId: "default", branchId: recordId(branchId), terminalId: uuid(terminalId),
    installationGeneration: uuid(installationGeneration), databaseGuid: uuid(databaseGuid), feedEpoch: uuid(feedEpoch) });
}

function commandFor(scope, input) {
  const { expectedVersion, patch } = input;
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1 || expectedVersion > 2147483646 || !plain(patch)) invalid();
  const fields = Object.keys(patch);
  if (!fields.length || fields.some(key => key !== "block_shift_close_on_hold" && key !== "max_drawer_cash_limit")) invalid();
  const changes = {};
  if (Object.hasOwn(patch, "block_shift_close_on_hold")) {
    if (typeof patch.block_shift_close_on_hold !== "boolean") invalid();
    changes.block_shift_close_on_hold = patch.block_shift_close_on_hold;
  }
  if (Object.hasOwn(patch, "max_drawer_cash_limit")) {
    if (typeof patch.max_drawer_cash_limit !== "string" || !DRAWER_LIMIT.test(patch.max_drawer_cash_limit)) invalid();
    changes.max_drawer_cash_limit = patch.max_drawer_cash_limit;
  }
  const command = { ...scope, personId: uuid(input.personId), operationId: uuid(input.operationId),
    expectedVersion, patch: Object.freeze(changes) };
  const commandJson = JSON.stringify(command);
  return Object.freeze({ ...command, commandJson, commandSha256: hash(commandJson) });
}

function checkedReceipt(command, verified) {
  if (verified?.commandSha256 !== command.commandSha256 || !plain(verified.receipt) || !plain(verified.receipt.result)) badReceipt();
  const { status, result } = verified.receipt;
  const context = { scope_id: command.branchId, epoch: command.feedEpoch, operation_id: command.operationId,
    terminal_id: command.terminalId, person_id: command.personId, installation_generation: command.installationGeneration,
    database_guid: command.databaseGuid, expected_version: command.expectedVersion };
  if (Object.entries(context).some(([key, expected]) => result[key] !== expected)) badReceipt();
  if (status === "REVIEW_REQUIRED" && result.code === "STALE_RULES")
    return { disposition: "REVIEW_REQUIRED", result: { ...context, code: result.code } };
  if ((status !== "APPLIED" && status !== "ALREADY_APPLIED") || result.row_version !== command.expectedVersion + 1 ||
      typeof result.seq !== "string" || !POSITIVE_SEQUENCE.test(result.seq) || BigInt(result.seq) > MAX_SEQUENCE) badReceipt();
  return { disposition: "APPLIED", result: { ...context, row_version: result.row_version, seq: result.seq } };
}

async function assertStoreSettingsEditHandbackClear(tx, { branchId, terminalId, rowVersion }) {
  if (!branchId || recordId(branchId) !== branchId || !Number.isInteger(rowVersion) || rowVersion < 1) invalid();
  const tables = await tx.request().query(`SELECT
    OBJECT_ID(N'dbo.pos_store_settings_edit_commands', N'U') AS commands,
    OBJECT_ID(N'dbo.pos_store_settings_edit_receipts', N'U') AS receipts,
    HAS_PERMS_BY_NAME(DB_NAME(), N'DATABASE', N'VIEW DEFINITION') AS can_see_schema;`);
  const { commands, receipts, can_see_schema: canSeeSchema } = tables.recordset[0];
  if (commands === null && receipts === null && canSeeSchema === 1) return;
  if (commands === null || receipts === null) pending();
  const result = await tx.request().input("branch", branchId).input("terminal", uuid(terminalId)).input("revision", rowVersion)
    .query(`SELECT TOP (1) 1 AS pending FROM dbo.pos_store_settings_edit_commands c WITH (UPDLOCK,HOLDLOCK)
      LEFT JOIN dbo.pos_store_settings_edit_receipts r WITH (UPDLOCK,HOLDLOCK) ON r.operation_id=c.operation_id
      WHERE c.branch_id=@branch AND c.terminal_id=@terminal AND (r.disposition IS NULL OR r.disposition<>N'APPLIED' OR
        TRY_CONVERT(int,JSON_VALUE(r.receipt_json,'$.result.row_version')) IS NULL OR
        TRY_CONVERT(int,JSON_VALUE(r.receipt_json,'$.result.row_version'))>@revision);`);
  if (result.recordset.length) pending();
}

/** Prepared repository. The caller owns the serializable transaction and Main-only authority. */
class StoreSettingsEditOutbox {
  constructor({ connectionManager, scope, assertContext, assertReceipt = badReceipt }) {
    if (!connectionManager || typeof assertContext !== "function" || typeof assertReceipt !== "function") invalid();
    Object.assign(this, { connectionManager, scope: scopeOf(scope), assertContext, assertReceipt });
  }

  request(tx) {
    const sql = this.connectionManager.sql();
    if (!(tx instanceof sql.Transaction)) wrongScope();
    return new sql.Request(tx);
  }

  async verify(tx, personId) {
    if (await this.assertContext(tx, this.scope, personId) !== true) wrongScope();
    if (await readDatabaseGuid(this.request(tx)) !== this.scope.databaseGuid) wrongScope();
  }

  commandFrom(row, personId) {
    let saved;
    try { saved = JSON.parse(row.command_json); } catch { invalid(); }
    const command = commandFor(this.scope, saved ?? {});
    if (command.personId !== personId || command.branchId !== row.branch_id || command.terminalId !== recordId(row.terminal_id) ||
        command.operationId !== recordId(row.operation_id) || command.commandJson !== row.command_json ||
        command.commandSha256 !== row.command_sha256) wrongScope();
    return command;
  }

  async operation(tx, operationId) {
    const result = await this.request(tx).input("operation", operationId).query(`SELECT ${COMMAND_COLUMNS}
      FROM dbo.pos_store_settings_edit_commands c WITH (UPDLOCK,HOLDLOCK)
      LEFT JOIN dbo.pos_store_settings_edit_receipts r WITH (UPDLOCK,HOLDLOCK) ON r.operation_id=c.operation_id
      WHERE c.operation_id=@operation;`);
    return result.recordset?.[0] ?? null;
  }

  async outstanding(tx) {
    const result = await this.request(tx).input("branch", this.scope.branchId).input("terminal", this.scope.terminalId)
      .query(`SELECT TOP (2) ${COMMAND_COLUMNS} FROM dbo.pos_store_settings_edit_commands c WITH (UPDLOCK,HOLDLOCK)
        LEFT JOIN dbo.pos_store_settings_edit_receipts r WITH (UPDLOCK,HOLDLOCK) ON r.operation_id=c.operation_id
        WHERE c.branch_id=@branch AND c.terminal_id=@terminal AND (r.disposition IS NULL OR r.disposition=N'REVIEW_REQUIRED')
        ORDER BY c.created_at,c.operation_id;`);
    const rows = result.recordset ?? [];
    if (rows.length > 1) invalid();
    return rows[0] ?? null;
  }

  async capture(tx, input) {
    const command = commandFor(this.scope, input);
    await this.verify(tx, command.personId);
    const current = await this.request(tx).input("branch", command.branchId).query(`SELECT store_id,row_version
      FROM dbo.pos_store_settings WITH (UPDLOCK,HOLDLOCK) WHERE store_id=@branch;`);
    const prior = await this.operation(tx, command.operationId);
    if (prior) {
      const saved = this.commandFrom(prior, command.personId);
      if (saved.commandSha256 !== command.commandSha256)
        refuse("ESETTINGS_EDIT_CONFLICT", "The operation already has a different saved settings edit.");
      await this.verify(tx, command.personId);
      return saved;
    }
    if (await this.outstanding(tx)) pending();
    if (current.recordset?.length !== 1 || recordId(current.recordset[0].store_id) !== command.branchId ||
        Number(current.recordset[0].row_version) !== command.expectedVersion)
      refuse("STALE_RULES", "The verified local revision changed. Refresh the current store rules before saving.");
    const unobserved = await this.request(tx).input("branch", command.branchId).input("terminal", command.terminalId)
      .input("expected", command.expectedVersion).query(`SELECT TOP (1) 1 AS found
        FROM dbo.pos_store_settings_edit_commands c JOIN dbo.pos_store_settings_edit_receipts r ON r.operation_id=c.operation_id
        WHERE c.branch_id=@branch AND c.terminal_id=@terminal AND r.disposition=N'APPLIED'
          AND TRY_CONVERT(int,JSON_VALUE(r.receipt_json,'$.result.row_version'))>@expected;`);
    if (unobserved.recordset?.length)
      refuse("ESETTINGS_EDIT_PENDING", "An accepted edit has not reached the local settings yet.");
    await this.request(tx).input("operation", command.operationId).input("branch", command.branchId)
      .input("terminal", command.terminalId).input("command", command.commandJson).input("hash", command.commandSha256)
      .query(`INSERT dbo.pos_store_settings_edit_commands (operation_id,branch_id,terminal_id,command_json,command_sha256)
        VALUES (@operation,@branch,@terminal,@command,@hash);`);
    await this.verify(tx, command.personId);
    return command;
  }

  async readPending(tx, { personId }) {
    personId = uuid(personId);
    await this.verify(tx, personId);
    const row = await this.outstanding(tx);
    const command = row && row.disposition === null ? this.commandFrom(row, personId) : null;
    await this.verify(tx, personId);
    return command;
  }

  async readUpload(tx, { personId }) {
    personId = personId === null ? null : uuid(personId);
    await this.verify(tx, personId);
    const row = await this.outstanding(tx);
    if (row?.disposition === "REVIEW_REQUIRED") return { status: "REVIEW_REQUIRED" };
    if (row) {
      let saved;
      try { saved = JSON.parse(row.command_json); } catch { invalid(); }
      if (!personId || saved?.personId !== personId) return { status: "AWAITING_OPERATOR" };
      return { status: "PENDING", command: this.commandFrom(row, personId) };
    }
    const awaiting = await this.request(tx).input("branch", this.scope.branchId).input("terminal", this.scope.terminalId)
      .query(`SELECT TOP (1) 1 AS pending FROM dbo.pos_store_settings_edit_commands c
        JOIN dbo.pos_store_settings_edit_receipts r ON r.operation_id=c.operation_id AND r.disposition=N'APPLIED'
        LEFT JOIN dbo.pos_store_settings s ON s.store_id COLLATE Latin1_General_100_BIN2=c.branch_id
        WHERE c.branch_id=@branch AND c.terminal_id=@terminal AND (s.row_version IS NULL OR
          TRY_CONVERT(int,JSON_VALUE(r.receipt_json,'$.result.row_version')) IS NULL OR
          TRY_CONVERT(int,JSON_VALUE(r.receipt_json,'$.result.row_version'))>s.row_version);`);
    return { status: awaiting.recordset?.length ? "AWAITING_DOWNLOAD" : "EMPTY" };
  }

  async acknowledge(tx, { personId, operationId, witness }) {
    personId = uuid(personId);
    await this.verify(tx, personId);
    const row = await this.operation(tx, uuid(operationId));
    if (!row) badReceipt();
    const command = this.commandFrom(row, personId);
    const receipt = checkedReceipt(command, await this.assertReceipt(witness, command));
    const receiptJson = JSON.stringify(receipt);
    if (row.disposition === null) {
      await this.request(tx).input("operation", command.operationId).input("disposition", receipt.disposition)
        .input("receipt", receiptJson).query(`INSERT dbo.pos_store_settings_edit_receipts (operation_id,disposition,receipt_json)
          VALUES (@operation,@disposition,@receipt);`);
    } else if (row.disposition !== receipt.disposition || row.receipt_json !== receiptJson) badReceipt();
    await this.verify(tx, personId);
    return receipt;
  }
}

module.exports = { StoreSettingsEditOutbox, assertStoreSettingsEditHandbackClear };
