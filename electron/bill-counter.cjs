/** Main-process serialized reservation; renderer cannot reset an existing counter. */
function reserveBillCounter(store, prefix, minimum) {
  if (typeof prefix !== "string" || !/^[A-Z0-9-]{1,100}$/.test(prefix) ||
      !Number.isSafeInteger(minimum) || minimum < 1 || minimum >= Number.MAX_SAFE_INTEGER)
    return {ok:false, code:"EBILL_COUNTER", error:"Invalid bill counter request."};
  const key = `setting:pos.bill.counter:${prefix}`;
  const saved = Number(store.get(key) ?? 0);
  let legacy = null;
  try { legacy = JSON.parse(store.get("setting:pos.bill.seq") ?? "null"); } catch { /* old unset counter */ }
  const next = Math.max(minimum, Number.isSafeInteger(saved) ? saved : 0,
    legacy?.prefix === prefix && Number.isSafeInteger(legacy.next) ? legacy.next : 0);
  if (!Number.isSafeInteger(next + 1)) return {ok:false, code:"EBILL_COUNTER", error:"Bill counter limit reached."};
  const result = store.set(key, next + 1);
  return result.ok ? {ok:true, sequence:next} : {ok:false, code:"EBILL_COUNTER", error:"The device could not persist its bill counter."};
}
// One Main-process queue also protects concurrent renderer reservations.
let stockTail = Promise.resolve();
function reserveStockCounter(store, pool, prefix, minimum) {
  const run = stockTail.then(async () => {
    if (typeof prefix !== "string" || !/^[A-Z0-9-]{1,200}$/.test(prefix) ||
        !Number.isSafeInteger(minimum) || minimum < 1 || minimum >= Number.MAX_SAFE_INTEGER)
      return { ok: false, code: "ESTOCK_COUNTER", error: "Invalid stock document counter request." };
    const key = `setting:pos.stockref.counter:${prefix}`;
    const raw = store.get(key);
    const saved = raw == null ? 0 : Number(raw);
    if (!Number.isSafeInteger(saved) || saved < 0)
      return { ok: false, code: "ESTOCK_COUNTER", error: "The saved stock document counter is invalid." };
    // Recover past references even when a legacy counter was reset or lost.
    // Only hard-coded identifiers enter SQL; the prefix is a bound parameter.
    const result = await pool.request().input("prefix", prefix).query(`
      SELECT MAX(TRY_CONVERT(bigint, SUBSTRING(reference,LEN(@prefix)+2,32))) AS last_sequence
      FROM (
        SELECT reference FROM dbo.stock_count_drafts
        UNION ALL SELECT reference FROM dbo.purchase_orders
        UNION ALL SELECT ref AS reference FROM dbo.stock_transfers
      ) documents
      WHERE reference LIKE @prefix+N'-%'
        AND LEN(SUBSTRING(reference,LEN(@prefix)+2,32)) BETWEEN 1 AND 16
        AND SUBSTRING(reference,LEN(@prefix)+2,32) NOT LIKE N'%[^0-9]%';`);
    const last = Number(result.recordset?.[0]?.last_sequence ?? 0);
    const next = Math.max(minimum, saved, last + 1);
    if (!Number.isSafeInteger(last) || last < 0 || !Number.isSafeInteger(next + 1))
      return { ok: false, code: "ESTOCK_COUNTER", error: "Stock document counter limit reached." };
    const stored = store.set(key, next + 1);
    if (!stored?.ok) return { ok: false, code: "ESTOCK_COUNTER", error: "The stock document counter could not be saved. Retry after checking device storage." };
    return { ok: true, sequence: next };
  }).catch(() => ({ ok: false, code: "ESTOCK_COUNTER", error: "Existing stock document numbers could not be checked. Check the local database connection and retry." }));
  stockTail = run.then(() => undefined);
  return run;
}
module.exports = { reserveBillCounter, reserveStockCounter };
