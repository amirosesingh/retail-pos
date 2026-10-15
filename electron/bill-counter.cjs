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
const { recordId } = require("./sync/uuid-fields.cjs");

/** One SQL batch owns the complete reservation; no settings, files or renderer cache. */
async function reserveStockCounter(sql, pool, branchId, prefix, minimum) {
  if (typeof branchId !== "string" || !branchId.trim() || branchId.length > 128 ||
      typeof prefix !== "string" || !/^[A-Z0-9-]{1,200}$/.test(prefix) ||
      !Number.isSafeInteger(minimum) || minimum < 1 || minimum >= Number.MAX_SAFE_INTEGER)
    return { ok: false, code: "ESTOCK_COUNTER", error: "Invalid branch or stock document counter request." };
  branchId = recordId(branchId);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      // Keep BEGIN/COMMIT and all lock-dependent work in this request: native
      // ODBC workers waiting on locks must not starve a holder's next request.
      const result = await pool.request().input("prefix", prefix).input("branch", branchId)
        .input("minimum", sql.BigInt, minimum).query(`
        SET XACT_ABORT ON;
        SET NOCOUNT ON;
        BEGIN TRY
          BEGIN TRANSACTION;
          DECLARE @saved bigint, @owner nvarchar(128), @last bigint, @next bigint;
          SELECT @saved=next_value,@owner=branch_id
            FROM dbo.pos_document_counters WITH (UPDLOCK,HOLDLOCK) WHERE prefix=@prefix;
          IF @owner IS NOT NULL AND @owner COLLATE Latin1_General_100_BIN2 <> @branch COLLATE Latin1_General_100_BIN2
            THROW 51021, 'The document prefix belongs to another branch.', 1;
          SELECT @last=MAX(TRY_CONVERT(bigint,SUBSTRING(reference,LEN(@prefix)+2,32)))
          FROM (
            SELECT reference FROM dbo.stock_count_drafts
            UNION ALL SELECT reference FROM dbo.purchase_orders
            UNION ALL SELECT ref AS reference FROM dbo.stock_transfers
          ) documents
          WHERE reference LIKE @prefix+N'-%'
            AND LEN(SUBSTRING(reference,LEN(@prefix)+2,32)) BETWEEN 1 AND 16
            AND SUBSTRING(reference,LEN(@prefix)+2,32) NOT LIKE N'%[^0-9]%';
          IF COALESCE(@last,0)>=9007199254740991 OR COALESCE(@saved,1)>9007199254740991
            THROW 51022, 'The stock document counter limit was reached.', 1;
          SELECT @next=MAX(value) FROM (VALUES(@minimum),(COALESCE(@saved,1)),(COALESCE(@last,0)+1)) candidates(value);
          IF @next>=9007199254740991 OR @next<1
            THROW 51022, 'The stock document counter limit was reached.', 1;
          IF @saved IS NULL
            INSERT dbo.pos_document_counters(prefix,branch_id,next_value) VALUES(@prefix,@branch,@next+1);
          ELSE
            UPDATE dbo.pos_document_counters SET next_value=@next+1,updated_at=SYSDATETIMEOFFSET()
            WHERE prefix=@prefix AND branch_id=@branch;
          COMMIT TRANSACTION;
          SELECT @next AS sequence;
        END TRY
        BEGIN CATCH
          IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
          THROW;
        END CATCH;`);
      const sequence = Number(result.recordset?.[0]?.sequence);
      if (!Number.isSafeInteger(sequence) || sequence < minimum) throw new Error("Invalid reservation acknowledgement");
      return { ok: true, sequence };
    } catch (error) {
      const number = Number(error?.number ?? error?.originalError?.info?.number);
      if (number === 1205 && attempt < 2) continue;
      return { ok: false, code: "ESTOCK_COUNTER", error: number === 51021
        ? "This document prefix belongs to another branch. Check branch and terminal activation before retrying."
        : "The stock number could not be reserved in SQL Server. Check the connection and apply the current local database update before retrying." };
    }
  }
}
module.exports = { reserveBillCounter, reserveStockCounter };
