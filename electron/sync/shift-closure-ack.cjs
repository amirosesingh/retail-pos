const { recordId } = require("./uuid-fields.cjs");

function closedShiftRows(operations) {
  return operations.flatMap(operation => operation.table === "shifts" && !operation.deletePhase
    ? (operation.rows ?? []).filter(row =>
      String(row.status ?? "").toUpperCase() === "CLOSED" ||
      String(row.state ?? "").toUpperCase() === "CLOSED" ||
      (row.closed_at !== null && row.closed_at !== undefined && row.closed_at !== ""))
    : []);
}

function revision(value) {
  if (typeof value !== "number" && (typeof value !== "string" || !/^\d+$/.test(value))) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 1 ? number : null;
}

// A total applied count cannot prove a particular shift reached CLOSED. Older
// servers can return ok even when their version predicate ignored that row.
// Require the atomic SQL postcondition's proof on new uploads AND receipt replay.
// Other table uploads retain their existing acknowledgement contract.
function assertShiftClosureAcknowledgement(acknowledgement, operations, branchId) {
  const rows = closedShiftRows(operations);
  if (!rows.length) return;
  const fail = () => {
    throw Object.assign(new Error(
      "The central database has not confirmed this shift closure. Its upload remains pending; check synchronization status before retrying.",
    ), { code: "ESHIFT_CLOSURE_UNCONFIRMED", table: "shifts" });
  };
  const branch = recordId(branchId);
  if (!branch || acknowledgement?.shift_closure_ack_version !== 2 ||
      !Array.isArray(acknowledgement.shift_closures)) return fail();
  const expected = new Map();
  for (const row of rows) {
    const id = recordId(row.id), rowVersion = revision(row.row_version);
    if (!id || recordId(row.store_id) !== branch || rowVersion === null || expected.has(id)) return fail();
    expected.set(id, rowVersion);
  }
  if (acknowledgement.shift_closures.length !== expected.size) return fail();
  const seen = new Set();
  for (const proof of acknowledgement.shift_closures) {
    const id = recordId(proof?.id), rowVersion = revision(proof?.row_version);
    const requestedVersion = revision(proof?.requested_row_version);
    if (!expected.has(id) || seen.has(id) || recordId(proof?.store_id) !== branch ||
        rowVersion === null || requestedVersion !== expected.get(id)) return fail();
    seen.add(id);
  }
}

module.exports = { assertShiftClosureAcknowledgement };
