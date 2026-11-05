// Called only with Main-owned scope, never renderer-supplied registration.
async function readShiftRules(connectionManager, transaction, branchId) {
  const result = await new (connectionManager.sql().Request)(transaction).input('branch', branchId)
    .query("SELECT (SELECT * FROM dbo.pos_store_settings WITH(HOLDLOCK) WHERE store_id IN(N'',@branch) FOR JSON PATH) rules_json;");
  const rows = JSON.parse(result.recordset?.[0]?.rules_json ?? '[]');
  const global = rows.find(row => row.store_id === '') ?? {};
  const local = rows.find(row => String(row.store_id).toLowerCase() === String(branchId).toLowerCase()) ?? {};
  // Column absent = legacy schema. New OFF must never be offered until upgrade.
  const effective = key => local[key] ?? global[key];
  return {
    sharing: effective('allow_branch_shift_sharing') !== false && effective('allow_branch_shift_sharing') !== 0,
    multiple: effective('allow_multiple_shifts_per_terminal') === true || effective('allow_multiple_shifts_per_terminal') === 1,
  };
}
function requireOwnShift(shift, terminalId, sharing) {
  if (sharing) return;
  if (!terminalId || !shift?.terminal_id || String(shift.terminal_id).toLowerCase() !== String(terminalId).toLowerCase())
    throw Object.assign(new Error("This branch requires each till to use its own shift. Open a shift on this till."), { code: 'ESHIFT_TERMINAL' });
}
module.exports = { readShiftRules, requireOwnShift };
