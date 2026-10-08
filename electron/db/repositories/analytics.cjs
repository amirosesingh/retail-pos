/** Branch reports are calculated in SQL; receipt lines never enter renderer memory. */
async function readAnalytics(connectionManager, branchId, from, to) {
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (!branchId || !day.test(from) || !day.test(to) || from > to)
    throw new Error("Choose a valid report date range and terminal branch.");
  const result = await connectionManager.pool
    .request()
    .input("branch", String(branchId))
    .input("from", from)
    .input("to", to).query(`
      SELECT CONVERT(varchar(10),s.created_at,23) sale_day,
        CONVERT(varchar(7),s.created_at,23) sale_month,s.store_id,si.sale_id,
        si.product_id,si.product_name,si.quantity,si.unit_price,si.is_foc,
        ROUND(discount.unit_discount*si.quantity+COALESCE(si.coupon_discount,0),2) line_discount,
        ROUND((CASE WHEN si.unit_price-discount.unit_discount>0 THEN si.unit_price-discount.unit_discount ELSE 0 END)*si.quantity-COALESCE(si.coupon_discount,0),2) line_revenue,
        ROUND(COALESCE(si.unit_cost,0)*si.quantity,2) line_cost
      INTO #facts
      FROM dbo.sale_items si JOIN dbo.sales s ON s.id=si.sale_id
      CROSS APPLY (SELECT ROUND(CASE WHEN si.discount_percent>0 THEN si.unit_price*si.discount_percent/100.0 ELSE COALESCE(si.discount_amount,0) END,2) unit_discount) discount
      WHERE s.store_id=@branch AND s.created_at>=CONVERT(date,@from)
        AND s.created_at<DATEADD(day,1,CONVERT(date,@to));
      SELECT sale_day,sale_month,store_id,COUNT(DISTINCT sale_id) bills,
        SUM(line_revenue) revenue,SUM(line_cost) cost,SUM(line_revenue-line_cost) profit,
        SUM(line_discount) discount,SUM(CASE WHEN is_foc=1 THEN unit_price*quantity ELSE 0 END) foc_value,SUM(quantity) units
      FROM #facts GROUP BY sale_day,sale_month,store_id ORDER BY sale_day;
      SELECT TOP (500001) f.sale_day,f.store_id,f.product_id,f.product_name,
        COALESCE(NULLIF(LTRIM(RTRIM(p.category)),''),'Uncategorized') product_category,
        SUM(f.quantity) units,SUM(f.line_revenue) revenue,SUM(f.line_cost) cost,SUM(f.line_revenue-f.line_cost) profit
      FROM #facts f LEFT JOIN dbo.products p ON p.id=f.product_id
      GROUP BY f.sale_day,f.store_id,f.product_id,f.product_name,p.category ORDER BY f.sale_day,f.product_id;
      SELECT TOP (500001) store_id,store_name_snapshot,created_at,total_amount,discount_amount,coupon_discount
      FROM dbo.sales WHERE store_id=@branch AND created_at>=CONVERT(date,@from)
        AND created_at<DATEADD(day,1,CONVERT(date,@to)) ORDER BY created_at,id;
      SELECT id,name,code,is_active FROM dbo.stores WHERE id=@branch;
      DROP TABLE #facts;
    `);
  const [storeDays = [], itemDays = [], bills = [], directory = []] = result.recordsets ?? [];
  if (itemDays.length > 500000 || bills.length > 500000)
    throw Object.assign(new Error("This report is too large. Select a shorter date range."), {
      code: "EREPORT_LIMIT",
    });
  return { ok: true, storeDays, itemDays, bills, directory };
}
module.exports = { readAnalytics };
