const { createHash } = require('node:crypto');
const { StockHistoryStore } = require('./db/stock-history.cjs');
const { identifier, fail } = require('./db/stock-history-contract.cjs');
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const permissions = value => {
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { fail('PERMISSION_DENIED'); } }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('PERMISSION_DENIED');
  return value;
};
function safeRequest(value) {
  const keys = new Set(['cutoff','timeZone','branchId','after','sourceRevision','limit','export','closedShiftId']);
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.has(key)) ||
      Buffer.byteLength(JSON.stringify(value), 'utf8') > 4096 || (value.export != null && typeof value.export !== 'boolean')) fail();
  return { ...value };
}
/** Dedicated read admission; no SQL text, ledger writes or renderer-selected identity. */
function createStockHistoryReader({manager,session,terminal,branch,isPosSender,context=()=>[]}) {
  return async (event,raw) => {
    try {
      if (!isPosSender(event) || !session.hasPosAuthority()) fail('PERMISSION_DENIED');
      const request = safeRequest(raw), pool = manager.pool, epoch = session.epoch();
      const actor = session.identity(), registered = terminal(), registeredBranch = branch();
      if (!pool || !actor || actor.source !== 'pos' || !UUID.test(actor.authorId ?? '') || !registered?.tokenId ||
          registered.deviceUse === 'management' || !registeredBranch) fail('PERMISSION_DENIED');
      const branchId = identifier(registeredBranch), authorId = identifier(actor.authorId,true);
      const binding = () => JSON.stringify([terminal(),context()]);
      const original = binding();
      const contextKey = createHash('sha256').update(JSON.stringify([epoch,authorId,branchId,original])).digest('hex');
      const assertCurrent = () => {
        if (manager.pool !== pool || session.epoch() !== epoch || !session.hasPosAuthority() || binding() !== original ||
            identifier(branch()) !== branchId) fail('ESTOCK_HISTORY_CONTEXT_CHANGED');
      };
      const authorizeRead = async (exporting) => {
        assertCurrent();
        const result = await pool.request().input('stock_actor',authorId).query(`
          SELECT id,user_id,role,role_slug,permissions,is_active,store_id FROM dbo.app_users
          WHERE id=TRY_CONVERT(uniqueidentifier,@stock_actor);`);
        assertCurrent();
        const person = result.recordset?.[0];
        if (!person || person.is_active !== true || identifier(String(person.id),true) !== authorId ||
            String(person.user_id).toLowerCase() !== String(actor.canonicalSubject ?? actor.subject).toLowerCase() ||
            (person.store_id != null && identifier(String(person.store_id)) !== branchId)) fail('PERMISSION_DENIED');
        const owner = String(person.role ?? '').toLowerCase() === 'admin' || String(person.role_slug ?? '').toLowerCase() === 'admin';
        const access = owner ? {} : permissions(person.permissions);
        const canViewInventory = owner || (access.can_view_inventory === true && access['page:inventory'] !== false);
        const canExportReports = owner || (access.can_export_reports === true && access['page:reports'] !== false);
        const canViewShiftHistory = owner || (access.can_shift_closing_history_view === true && access['page:shifts'] !== false);
        if (!canViewInventory || (exporting && !canExportReports)) fail('PERMISSION_DENIED');
        return {contextKey,branchId,canViewInventory,canExportReports,canViewShiftHistory};
      };
      const store = new StockHistoryStore(manager,{assertCurrent,authorizeRead});
      const page = await store.readPage(request); assertCurrent(); session.touch();
      return {ok:true,page};
    } catch (error) {
      const code = typeof error?.code === 'string' && /^(?:ESTOCK_HISTORY_|PERMISSION_DENIED$|SYNC_BRANCH_FORBIDDEN$)/.test(error.code) ? error.code : 'ESTOCK_HISTORY_READ';
      return {ok:false,code,error:code === 'PERMISSION_DENIED' ? 'Your current account or terminal cannot read this stock report.' :
        code === 'ESTOCK_HISTORY_SOURCE_CHANGED' ? 'Stock history changed. Refresh the report before continuing.' :
        code === 'ESTOCK_HISTORY_CONTEXT_CHANGED' ? 'The signed-in account, terminal or database changed. Open the report again.' :
        code === 'ESTOCK_HISTORY_SHIFT_UNAVAILABLE' ? 'The selected shift is not closed or is outside this location.' :
        'The local stock-history report could not be verified. Existing stock has not been changed.'};
    }
  };
}
function registerStockHistoryRead(options) {
  const handler = createStockHistoryReader(options);
  options.ipcMain.handle('business:stock-history',handler);
  return handler;
}
module.exports = {createStockHistoryReader,registerStockHistoryRead};
