const { createHash } = require('node:crypto');
const { binding } = require('./verified-activation.cjs');
const { identifier, fail } = require('./db/stock-history-contract.cjs');
const { catalogueReadPredicate } = require('./db/catalogue-scope.cjs');

const readPermission = 'can_view_inventory';
const costPermission = 'can_view_cost_margin';
const exportPermission = 'can_export_reports';
const shiftPermission = 'can_shift_closing_history_view';
const limit = 20_000;

function personPermissions(value) {
  if (typeof value === 'string') {
    try { value = JSON.parse(value); }
    catch { fail('PERMISSION_DENIED'); }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('PERMISSION_DENIED');
  return value;
}

function createManagementInventoryAdmission({ manager, databaseService, session, terminal, cloud, isPosSender }) {
  return async (event, { branchId, exporting = false, requiredPermission } = {}) => {
    if (!isPosSender(event) || !session.hasPosAuthority() ||
        !(session.hasLevel('admin') || session.hasPermission(readPermission))) fail('PERMISSION_DENIED');
    const actor = session.identity(), epoch = session.epoch(), registered = binding(terminal());
    if (registered?.mode !== 'management' || registered.platform !== 'pc' || actor?.source !== 'pos') fail('PERMISSION_DENIED');
    const authorId = identifier(actor.authorId, true), terminalId = identifier(registered.id, true);
    const pool = manager.pool;
    const ready = () => databaseService.snapshot().tradingReady && manager.isConnected();
    if (!pool || !ready()) fail('ESTOCK_HISTORY_MANAGEMENT_SQL');
    const proof = cloud.verifiedManagementStockScope();
    if (!proof || proof.pool !== pool || proof.terminal?.deviceUse !== 'management' ||
        !proof.terminal.deviceBindingProof || !proof.terminal.deviceClaimProof || proof.branches.length > 500)
      fail('ESTOCK_HISTORY_MANAGEMENT_SCOPE');
    let projectOrigin;
    try { projectOrigin = new URL(proof.project?.projectOrigin).origin; }
    catch { fail('ESTOCK_HISTORY_MANAGEMENT_SCOPE'); }
    const contextKey = createHash('sha256').update(JSON.stringify([epoch, authorId, branchId ?? null, proof.fingerprint, proof.stamp])).digest('hex');
    const assertCurrent = () => {
      const retained = cloud.verifiedManagementStockScope();
      if (manager.pool !== pool || !ready() || session.epoch() !== epoch || !session.hasPosAuthority() ||
          retained?.fingerprint !== proof.fingerprint || retained?.stamp !== proof.stamp)
        fail('ESTOCK_HISTORY_CONTEXT_CHANGED');
    };
    const authorizeRead = async (needsExport = exporting) => {
      assertCurrent();
      const account = (await pool.request().input('stock_actor', authorId).query(`
        SELECT id,user_id,role,role_slug,permissions,is_active,store_id FROM dbo.app_users
        WHERE id=TRY_CONVERT(uniqueidentifier,@stock_actor);`)).recordset?.[0];
      assertCurrent();
      if (!account || account.is_active !== true || identifier(String(account.id), true) !== authorId ||
          String(account.user_id).toLowerCase() !== String(actor.canonicalSubject ?? actor.subject).toLowerCase())
        fail('PERMISSION_DENIED');
      const owner = account.role === 'admin' || account.role_slug === 'admin';
      const supervisor = account.role === 'manager' || account.role_slug === 'supervisor';
      const access = owner ? {} : personPermissions(account.permissions);
      const allowed = (permission, page) => (session.hasLevel('admin') || session.hasPermission(permission)) &&
        (owner || (access[permission] === true && access[`page:${page}`] !== false));
      const canViewInventory = allowed(readPermission, 'inventory');
      const canViewCost = allowed(costPermission, 'inventory');
      const canExportReports = allowed(exportPermission, 'reports');
      const canViewShiftHistory = allowed(shiftPermission, 'shifts');
      if (!(owner || access.can_use_management_pc === true || (access.can_use_management_pc === undefined && supervisor)) ||
          !canViewInventory || (needsExport && !canExportReports) || (requiredPermission === shiftPermission && !canViewShiftHistory))
        fail('PERMISSION_DENIED');
      const assigned = [actor.branchId, account.store_id].filter(Boolean).map(value => identifier(String(value)));
      if (new Set(assigned).size > 1 || (!assigned.length &&
          (!['admin', 'supervisor'].includes(actor.level) || !(owner || supervisor)))) fail('PERMISSION_DENIED');
      const branchIds = proof.branches.filter(id => !assigned.length || id === assigned[0]);
      if (branchId && !branchIds.includes(branchId)) fail('SYNC_BRANCH_FORBIDDEN');
      return { contextKey, branchId, terminalId, projectOrigin, canViewInventory, canViewCost, canExportReports,
        canViewShiftHistory, branchIds };
    };
    const access = await authorizeRead();
    const locations = async (requested = access.branchIds) => {
      if (requested.some(id => !access.branchIds.includes(id))) fail('SYNC_BRANCH_FORBIDDEN');
      const result = await pool.request().input('report_branches', JSON.stringify(requested)).query(`
        SELECT s.id,s.code,s.name,s.location_type,s.is_active,
          CASE WHEN EXISTS (SELECT 1 FROM dbo.pos_jobs ready WHERE ready.branch_id=s.id
            AND ready.job_type=N'bootstrap_7300' AND ready.status=N'completed'
            AND NOT EXISTS (SELECT 1 FROM dbo.pos_jobs other WHERE other.branch_id=s.id
              AND other.job_type LIKE N'bootstrap_%' AND other.status<>N'completed' AND other.updated_at>=ready.updated_at))
            THEN 1 ELSE 0 END AS replicaReady
        FROM dbo.stores s JOIN OPENJSON(@report_branches) branch
          ON s.id COLLATE Latin1_General_100_BIN2=branch.[value] COLLATE Latin1_General_100_BIN2
        WHERE s.deleted_at IS NULL ORDER BY s.name,s.id;`);
      assertCurrent();
      return (result.recordset ?? []).map(row => ({ id: identifier(row.id), code: row.code ?? '', name: row.name,
        locationType: row.location_type, active: row.is_active !== false, replicaReady: row.replicaReady === 1 }));
    };
    if (branchId && !(await locations([branchId])).some(location => location.id === branchId && location.replicaReady))
      fail('ESTOCK_HISTORY_MANAGEMENT_INCOMPLETE');
    return { ...access, pool, proof, authorizeRead, assertCurrent, locations };
  };
}

const errors = {
  PERMISSION_DENIED: 'This account cannot read the Management inventory replica.',
  SYNC_BRANCH_FORBIDDEN: 'Choose a location authorized for this account and Management terminal.',
  ESTOCK_HISTORY_CONTEXT_CHANGED: 'The account, terminal or local SQL connection changed. Open the report again.',
  ESTOCK_HISTORY_MANAGEMENT_SQL: 'The Management local SQL Server database is not ready.',
  ESTOCK_HISTORY_MANAGEMENT_SCOPE: 'Connect and synchronize this Management terminal to verify its location access.',
  ESTOCK_HISTORY_MANAGEMENT_INCOMPLETE: 'Some selected locations have not completed their local inventory download.',
  ESTOCK_HISTORY_MANAGEMENT_SOURCE: 'The local inventory for the selected locations has not been verified against this Management terminal’s connected project.',
  ESTOCK_HISTORY_MANAGEMENT_LIMIT: 'The selected inventory is too large to load together. Select one location.',
};

function createManagementInventoryReader(admission, session, registry, inventorySource) {
  const catalogueScope = catalogueReadPredicate(registry, 'p', 'locations.[id]');
  return async (event, input) => {
    try {
      if (!input || typeof input !== 'object' || Array.isArray(input) ||
          Object.keys(input).some(key => !['kind', 'branchId', 'all'].includes(key)) ||
          !['locations', 'current', 'authorize-export'].includes(input.kind)) fail();
      const { kind, all } = input;
      if (kind === 'locations' ? Object.keys(input).length !== 1 :
          all === true ? Object.hasOwn(input, 'branchId') : Object.hasOwn(input, 'all') || typeof input.branchId !== 'string') fail();
      const branchId = kind !== 'locations' && all !== true ? identifier(input.branchId) : undefined;
      const context = await admission(event, { branchId, exporting: kind === 'authorize-export' });
      const locations = await context.locations(branchId ? [branchId] : undefined);
      if (kind === 'locations') {
        const after = await context.authorizeRead();
        if (JSON.stringify(after.branchIds) !== JSON.stringify(context.branchIds)) fail('ESTOCK_HISTORY_CONTEXT_CHANGED');
        session.touch();
        return { ok: true, locations };
      }
      if (!locations.length || locations.some(row => !row.replicaReady) || (!branchId && locations.length !== context.branchIds.length))
        fail('ESTOCK_HISTORY_MANAGEMENT_INCOMPLETE');
      const selectedBranchIds = locations.map(row => row.id);
      await inventorySource.assertVerified(context.proof, selectedBranchIds);
      if (kind === 'authorize-export') {
        const after = await context.authorizeRead(true);
        if (JSON.stringify(after.branchIds) !== JSON.stringify(context.branchIds)) fail('ESTOCK_HISTORY_CONTEXT_CHANGED');
        await inventorySource.assertVerified(context.proof, selectedBranchIds);
        context.assertCurrent();
        return { ok: true, locations, canViewCost: after.canViewCost };
      }
      const result = await context.pool.request().input('report_branches', JSON.stringify(locations.map(row => row.id)))
        .input('report_terminal', context.terminalId).input('report_limit', limit + 1).query(`
          SELECT TOP (@report_limit) p.id,p.name,p.sku,p.barcode,p.brand,p.category,p.sub_category,p.is_archived,
            p.reorder_level,locations.id AS location_id,COALESCE(balance.quantity,0) AS quantity
            ${context.canViewCost ? ',p.cost_price,COALESCE(price.selling_price,p.selling_price) AS selling_price' : ''}
          FROM dbo.products p
          CROSS JOIN (SELECT s.id,s.group_id FROM dbo.stores s JOIN OPENJSON(@report_branches) requested
            ON s.id COLLATE Latin1_General_100_BIN2=requested.[value] COLLATE Latin1_General_100_BIN2 WHERE s.deleted_at IS NULL) locations
          OUTER APPLY (SELECT TOP (1) TRY_CONVERT(bigint,stock.[value]) AS quantity
            FROM OPENJSON(CASE WHEN ISJSON(p.stock_by_store)=1 THEN p.stock_by_store ELSE N'{}' END) stock
            WHERE (CASE WHEN DATALENGTH(stock.[key])=72 AND TRY_CONVERT(uniqueidentifier,stock.[key]) IS NOT NULL
              THEN LOWER(CONVERT(nvarchar(36),TRY_CONVERT(uniqueidentifier,stock.[key]))) ELSE stock.[key] END)
              COLLATE Latin1_General_100_BIN2=locations.id COLLATE Latin1_General_100_BIN2) balance
          ${context.canViewCost ? `OUTER APPLY (SELECT TOP (1)
              TRY_CONVERT(decimal(38,12),JSON_VALUE(CASE WHEN ISJSON(config.[value])=1 THEN config.[value] ELSE N'{}' END,N'$.selling_price')) selling_price
            FROM dbo.settings_scoped config WHERE config.[key]=CONCAT(N'product_price:',LOWER(CONVERT(nvarchar(36),p.id)))
              AND (LOWER(config.[scope])=N'global' OR
                (LOWER(config.[scope])=N'cluster' AND config.scope_id=COALESCE(NULLIF(locations.group_id,N''),N'default')) OR
                (LOWER(config.[scope])=N'branch' AND config.scope_id=locations.id) OR
                (LOWER(config.[scope])=N'terminal' AND config.scope_id=@report_terminal))
            ORDER BY CASE LOWER(config.[scope]) WHEN 'terminal' THEN 4 WHEN 'branch' THEN 3 WHEN 'cluster' THEN 2 ELSE 1 END DESC,
              config.updated_at DESC, config.scope_id DESC) price` : ''}
          WHERE p.deleted_at IS NULL AND ${catalogueScope}
          ORDER BY p.id,locations.id;`);
      const after = await context.authorizeRead();
      await inventorySource.assertVerified(context.proof, selectedBranchIds);
      if (after.canViewCost !== context.canViewCost || JSON.stringify(after.branchIds) !== JSON.stringify(context.branchIds))
        fail('ESTOCK_HISTORY_CONTEXT_CHANGED');
      const rows = result.recordset ?? [];
      if (rows.length > limit) fail('ESTOCK_HISTORY_MANAGEMENT_LIMIT');
      // Build only approved fields. The underlying catalogue and settings rows
      // may carry other locations' stock, scoped prices or personal metadata.
      const products = new Map();
      const selectedLocations = new Set(locations.map(store => store.id));
      for (const row of rows) {
        const id = identifier(row.id, true), location = identifier(row.location_id);
        if (!selectedLocations.has(location)) fail('ESTOCK_HISTORY_CONTEXT_CHANGED');
        if (!products.has(id)) products.set(id, {
          id, name: row.name, sku: row.sku ?? row.barcode ?? '', barcode: row.barcode ?? '',
          brand: row.brand ?? undefined, category: row.category ?? '', subCategory: row.sub_category ?? undefined,
          archived: row.is_archived === true, reorderLevel: Number(row.reorder_level),
          cost: context.canViewCost && row.cost_price != null ? Number(row.cost_price) : null, stockByStore: Object.create(null),
          retailPriceByStore: Object.create(null),
        });
        const product = products.get(id);
        product.stockByStore[location] = Number(row.quantity);
        if (context.canViewCost && row.selling_price != null) product.retailPriceByStore[location] = Number(row.selling_price);
      }
      context.assertCurrent();
      session.touch();
      return { ok: true, locations, products: [...products.values()], canViewCost: context.canViewCost, canExportReports: after.canExportReports };
    } catch (error) {
      const code = Object.hasOwn(errors, error?.code) ? error.code : 'ESTOCK_HISTORY_MANAGEMENT_READ';
      return { ok: false, code, error: errors[code] ?? 'The local Management inventory could not be verified.' };
    }
  };
}

module.exports = { createManagementInventoryAdmission, createManagementInventoryReader };
