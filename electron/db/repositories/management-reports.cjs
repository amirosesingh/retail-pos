const { reportDays } = require("../report-days.cjs");
const { recordId } = require("../../sync/uuid-fields.cjs");
const refuse = (code, message) => { throw Object.assign(new Error(message), { code }); };

/** Separate read-only capability: never opens the management replica to generic writes. */
async function readManagementReport({ manager, databaseService, session, management, options, redactShift }) {
  const shiftPage = require("../../permission-pages.json").find(page => page.id === "shifts");
  const shiftAccess = session.hasLevel("admin") || (session.identity()?.permissions?.["page:shifts"] !== false && shiftPage.keys.some(key => session.hasPermission(key)));
  const exactShiftSales = options?.kind === "sales" && options?.shiftId && shiftAccess && ["can_shift_expected_cash_view", "can_shift_report_reprint"].some(key => session.hasPermission(key));
  if (!management || !session.hasPosAuthority() || (options?.kind === "shifts" ? !shiftAccess : !(session.hasPermission("can_view_sales_reports") || exactShiftSales)))
    refuse("PERMISSION_DENIED", "A registered management computer and sales report permission are required.");
  if (!manager.isConnected() || !databaseService.snapshot().tradingReady)
    refuse("EDATABASE_NOT_READY", "The management SQL Server replica is not ready.");
  const ids = [...new Set((options?.storeIds ?? []).map(value => typeof value === "string" ? recordId(value.trim()) : ""))];
  if (!ids.length || ids.length > 500 || ids.some(id => !id || id.length > 128)) refuse("EQUERY_SCOPE", "Choose authorized shops for this report.");
  const assigned = session.branchId();
  if (assigned && ids.some(id => recordId(id) !== recordId(assigned))) refuse("PERMISSION_DENIED", "This account is assigned to a different branch.");
  const { from, to, zone = "UTC", kind, shiftId } = options;
  if (!["sales", "totals", "shifts"].includes(kind) || typeof zone !== "string" || zone.length > 80 || from > to) refuse("EQUERY_RANGE", "Choose a valid management report range.");
  if (shiftId != null && (kind !== "sales" || typeof shiftId !== "string" || !shiftId || shiftId.length > 128)) refuse("EQUERY_SCOPE", "Choose a valid shift.");
  const start = shiftId ? null : reportDays(from, from, zone)[0].start;
  const end = shiftId ? null : reportDays(to, to, zone)[0].end;
  // A schema-ready database is not proof of a complete business replica. Every
  // requested branch needs the full-history bootstrap, with no partial rebuild.
  const proof = await manager.pool.request().input("branches", JSON.stringify(ids)).query(`
    SELECT requested.[value] id FROM OPENJSON(@branches) requested
    WHERE NOT EXISTS(SELECT 1 FROM dbo.stores s WHERE s.id=requested.[value])
       OR NOT EXISTS(SELECT 1 FROM dbo.pos_jobs j WHERE j.branch_id=requested.[value] AND j.job_type=N'bootstrap_7300' AND j.status=N'completed')
       OR EXISTS(SELECT 1 FROM dbo.pos_jobs j WHERE j.branch_id=requested.[value] AND j.job_type LIKE N'bootstrap_%' AND j.status<>N'completed'
         AND NOT EXISTS(SELECT 1 FROM dbo.pos_jobs recovered WHERE recovered.branch_id=j.branch_id AND recovered.job_type=N'bootstrap_7300' AND recovered.status=N'completed' AND recovered.updated_at>j.updated_at));
  `);
  if (proof.recordset?.length) refuse("EMANAGEMENT_REPLICA_INCOMPLETE", "Some shops have not completed the full management download. Connect online to finish synchronization.");
  const request = manager.pool.request().input("branches", JSON.stringify(ids)).input("from", start).input("to", end);
  const dates = row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value]));
  const selected = `s.store_id IN(SELECT [value] FROM OPENJSON(@branches)) AND ${shiftId ? "s.shift_id=@shift" : "s.created_at>=CONVERT(datetimeoffset,@from) AND s.created_at<CONVERT(datetimeoffset,@to)"}`;
  if (shiftId) {
    request.input("shift", shiftId);
    const shift = await manager.pool.request().input("shift", shiftId).input("branches", JSON.stringify(ids))
      .query("SELECT id FROM dbo.shifts WHERE id=TRY_CONVERT(uniqueidentifier,@shift) AND store_id IN(SELECT [value] FROM OPENJSON(@branches));");
    if (!shift.recordset?.length) refuse("EQUERY_SCOPE", "The shift does not belong to an authorized report branch.");
  }
  const mayProfit = options.includeProfit === true && session.hasPermission("can_view_cost_margin");
  if (kind === "totals") {
    if (options.includeProfit === true && !mayProfit) refuse("PERMISSION_DENIED", "Cost and margin permission is required.");
    const result = await request.query(`SELECT s.store_id,COUNT_BIG(*) bills,
      SUM(s.total_amount-COALESCE(s.tax_amount,0)-COALESCE(s.rounding_adjustment,0)) revenue
      ${mayProfit ? ",SUM(s.total_amount-COALESCE(s.tax_amount,0)-COALESCE(s.rounding_adjustment,0)-COALESCE(cost.value,0)) profit" : ""}
      FROM dbo.sales s ${mayProfit ? "OUTER APPLY(SELECT SUM(ROUND(COALESCE(si.unit_cost,p.cost_price,0)*si.quantity,2)) value FROM dbo.sale_items si LEFT JOIN dbo.products p ON p.id=si.product_id WHERE si.sale_id=s.id) cost" : ""}
      WHERE ${selected} AND COALESCE(s.is_refunded,0)=0 GROUP BY s.store_id;`);
    return { ok: true, complete: true, source: "management-local", storeTotals: result.recordset ?? [] };
  }
  const limit = Math.max(1, Math.min(500, Number(options.limit) || 500));
  request.input("limit", limit);
  const table = kind === "shifts" ? "shifts" : "sales", at = kind === "shifts" ? "opened_at" : "created_at";
  let cursor = "";
  if (options.cursor) {
    if (!Number.isFinite(Date.parse(options.cursor.ts)) || typeof options.cursor.id !== "string" || options.cursor.id.length > 128) refuse("EQUERY_CURSOR", "Invalid report cursor.");
    request.input("cursorAt", options.cursor.ts).input("cursorId", recordId(options.cursor.id));
    cursor = ` AND (s.${at}<CONVERT(datetimeoffset,@cursorAt) OR (s.${at}=CONVERT(datetimeoffset,@cursorAt) AND LOWER(CONVERT(nvarchar(128),s.id))<@cursorId))`;
  }
  if (kind === "shifts") {
    if (typeof redactShift !== "function") refuse("EMANAGEMENT_REPORT", "The shift privacy projection is unavailable.");
    const result = await request.query(`SELECT TOP (@limit) s.* FROM dbo.${table} s WHERE ${selected.replaceAll("created_at", "opened_at")}${cursor} ORDER BY s.opened_at DESC,LOWER(CONVERT(nvarchar(128),s.id)) DESC;`);
    const rows = (result.recordset ?? []).map(row => dates(redactShift(row))), last = rows.at(-1);
    return { ok: true, complete: true, source: "management-local", rows, hasMore: rows.length >= limit, cursor: last ? { ts: last.opened_at, id: recordId(last.id) } : null };
  }
  const result = await request.query(`SELECT TOP (@limit) s.* INTO #selected_sales FROM dbo.sales s WHERE ${selected}${cursor} ORDER BY s.created_at DESC,LOWER(CONVERT(nvarchar(128),s.id)) DESC;
    SELECT * FROM #selected_sales ORDER BY created_at DESC,LOWER(CONVERT(nvarchar(128),id)) DESC;
    SELECT TOP (500001) si.* FROM dbo.sale_items si JOIN #selected_sales s ON s.id=si.sale_id;
    DROP TABLE #selected_sales;`);
  const [heads = [], items = []] = result.recordsets ?? [];
  if (items.length > 500000) refuse("EREPORT_LIMIT", "This report page has too many bill lines. Choose a smaller range.");
  const bySale = new Map();
  for (const item of items) {
    const row = session.hasPermission("can_view_cost_margin") ? item : { ...item, unit_cost: null };
    const id = recordId(item.sale_id), list = bySale.get(id) ?? []; list.push(row); bySale.set(id, list);
  }
  const rows = heads.map(row => ({ ...dates(row), sale_items: (bySale.get(recordId(row.id)) ?? []).map(dates) }));
  const last = heads.at(-1);
  return { ok: true, complete: true, source: "management-local", rows,
    hasMore: heads.length >= limit, cursor: last ? { ts: new Date(last.created_at).toISOString(), id: recordId(last.id) } : null };
}
module.exports = { readManagementReport };
