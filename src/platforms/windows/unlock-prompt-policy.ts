/** UI prompting only. Electron remains the authority for every permission. */
const maintenanceCalls = new Set([
  "pos.database.setEnabled", "pos.database.saveAndConnect", "pos.database.provisionAndConnect",
  "pos.database.migrate", "pos.database.migrateSavedDatabase", "pos.database.disconnect",
  "pos.database.removeConfiguration", "pos.database.backup", "pos.database.restore",
  "pos.applySchema", "pos.applySchemaTables", "pos.backup", "pos.restore",
  "pos.rollbackNow", "pos.clearAppCache",
]);

export function canPromptForUnlock(call: string, userInitiated: boolean): boolean {
  return userInitiated && maintenanceCalls.has(call);
}
