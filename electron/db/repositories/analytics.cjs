const { reportDays } = require("../report-days.cjs");
/** Branch reports are calculated in SQL; receipt lines never enter renderer memory. */
async function readAnalytics(connectionManager, branchId, from, to, timeZone = "UTC") {
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (!branchId || !day.test(from) || !day.test(to) || from > to)
    throw new Error("Choose a valid report date range and terminal branch.");
  const days = reportDays(from, to, timeZone);
  const result = await connectionManager.pool
    .request()
    .input("branch", String(branchId))
    .input("days", JSON.stringify(days)).query(`
      SELECT day sale_day,LEFT(day,7) sale_month,CAST(start_at AS datetime2) start_at,CAST(end_at AS datetime2) end_at
      INTO #days FROM OPENJSON(@days) WITH(day varchar(10) '$.day',start_at datetimeoffset '$.start',end_at datetimeoffset '$.end');
      SELECT s.*,d.sale_day,d.sale_month INTO #bills FROM dbo.sales s JOIN #days d
        ON s.created_at>=d.start_at AND s.created_at<d.end_at
        WHERE s.store_id=@branch AND COALESCE(s.is_refunded,0)=0;
      ;WITH raw AS (
        SELECT s.sale_day,s.sale_month,s.store_id,si.sale_id,si.id,si.product_id,si.product_name,
          si.quantity,si.unit_price,si.is_foc,si.unit_cost,p.cost_price fallback_cost,
          ROUND(s.total_amount-COALESCE(s.tax_amount,0)-COALESCE(s.rounding_adjustment,0),2) net_total,
          ABS(si.unit_price*si.quantity) gross,
          CASE WHEN ABS(COALESCE(si.coupon_discount,0))>ABS(si.unit_price*si.quantity) THEN ABS(si.unit_price*si.quantity) ELSE ABS(COALESCE(si.coupon_discount,0)) END coupon,
          si.discount_percent,si.discount_amount
        FROM dbo.sale_items si JOIN #bills s ON s.id=si.sale_id LEFT JOIN dbo.products p ON p.id=si.product_id
      ), discounted AS (
        SELECT raw.*,ROUND(CASE WHEN own.value>gross-coupon THEN gross-coupon WHEN own.value<0 THEN 0 ELSE own.value END,2) own_discount
        FROM raw CROSS APPLY (SELECT CASE WHEN discount_percent>0 THEN (gross-coupon)*(CASE WHEN discount_percent>100 THEN 100 ELSE discount_percent END)/100.0 ELSE COALESCE(discount_amount,0)*ABS(quantity) END value) own
      ), weights AS (
        SELECT discounted.*,CASE WHEN is_foc=1 THEN 0 ELSE (gross-coupon-own_discount)*(CASE WHEN quantity<0 THEN -1 ELSE 1 END) END weight FROM discounted
      ), totals AS (
        SELECT weights.*,SUM(weight) OVER(PARTITION BY sale_id) weight_total,
          MAX(CASE WHEN weight<>0 THEN CAST(id AS varchar(64)) ELSE NULL END) OVER(PARTITION BY sale_id) last_line FROM weights
      ), allocated AS (
        SELECT totals.*,ROUND(CASE WHEN weight_total<>0 THEN weight/weight_total*net_total ELSE 0 END,2) allocated_revenue FROM totals
      )
      SELECT sale_day,sale_month,store_id,sale_id,product_id,product_name,quantity,unit_price,is_foc,
        own_discount*(CASE WHEN quantity<0 THEN -1 ELSE 1 END) line_discount,
        CASE WHEN CAST(id AS varchar(64))=last_line THEN net_total-SUM(allocated_revenue) OVER(PARTITION BY sale_id)+allocated_revenue ELSE allocated_revenue END line_revenue,
        ROUND(COALESCE(unit_cost,fallback_cost,0)*quantity,2) line_cost
      INTO #facts FROM allocated;
      SELECT b.sale_day,b.sale_month,b.store_id,COUNT(*) bills,
        SUM(b.total_amount-COALESCE(b.tax_amount,0)-COALESCE(b.rounding_adjustment,0)) revenue,
        SUM(COALESCE(f.cost,0)) cost,
        SUM(b.total_amount-COALESCE(b.tax_amount,0)-COALESCE(b.rounding_adjustment,0)-COALESCE(f.cost,0)) profit,
        SUM(COALESCE(f.discount,0)) discount,SUM(COALESCE(f.foc_value,0)) foc_value,SUM(COALESCE(f.units,0)) units
      FROM #bills b LEFT JOIN (SELECT sale_id,SUM(line_cost) cost,SUM(line_discount) discount,
        SUM(CASE WHEN is_foc=1 THEN unit_price*quantity ELSE 0 END) foc_value,SUM(quantity) units FROM #facts GROUP BY sale_id) f ON f.sale_id=b.id
      GROUP BY b.sale_day,b.sale_month,b.store_id ORDER BY b.sale_day;
      SELECT TOP (500001) f.sale_day,f.store_id,f.product_id,f.product_name,
        COALESCE(NULLIF(LTRIM(RTRIM(p.category)),''),'Default') product_category,
        SUM(f.quantity) units,SUM(f.line_revenue) revenue,SUM(f.line_cost) cost,SUM(f.line_revenue-f.line_cost) profit
      FROM #facts f LEFT JOIN dbo.products p ON p.id=f.product_id
      GROUP BY f.sale_day,f.store_id,f.product_id,f.product_name,p.category ORDER BY f.sale_day,f.product_id;
      SELECT TOP (500001) store_id,store_name_snapshot,created_at,total_amount,discount_amount,coupon_discount
      FROM #bills ORDER BY created_at,id;
      SELECT id,name,code,is_active FROM dbo.stores WHERE id=@branch;
      DROP TABLE #facts; DROP TABLE #bills; DROP TABLE #days;
    `);
  const [storeDays = [], itemDays = [], bills = [], directory = []] = result.recordsets ?? [];
  if (itemDays.length > 500000 || bills.length > 500000)
    throw Object.assign(new Error("This report is too large. Select a shorter date range."), {
      code: "EREPORT_LIMIT",
    });
  return { ok: true, storeDays, itemDays, bills, directory };
}
module.exports = { readAnalytics };
