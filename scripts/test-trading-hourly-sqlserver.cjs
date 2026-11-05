"use strict";
// Disposable LocalDB only; never reads operator configuration or POS_Local.
const assert = require("node:assert/strict");
const { createOwnedUpgradeFixture } = require("./lib/owned-upgrade-fixture.cjs");
const { readAnalytics } = require("../electron/db/repositories/analytics.cjs");
assert.deepEqual(process.argv.slice(2), ["--run"]);
async function main() {
  const fixture = await createOwnedUpgradeFixture();
  try {
    await fixture.pool.request().batch(`
      CREATE TABLE dbo.stores(id nvarchar(64),name nvarchar(100),code nvarchar(100),is_active bit);
      CREATE TABLE dbo.products(id uniqueidentifier,category nvarchar(100),cost_price decimal(18,4));
      CREATE TABLE dbo.sales(id uniqueidentifier,store_id nvarchar(64),created_at datetime2(7),
        total_amount decimal(18,4),tax_amount decimal(18,4),rounding_adjustment decimal(18,4),
        is_refunded bit,store_name_snapshot nvarchar(100),discount_amount decimal(18,4),coupon_discount decimal(18,4));
      CREATE TABLE dbo.sale_items(id uniqueidentifier,sale_id uniqueidentifier,product_id uniqueidentifier,
        product_name nvarchar(100),quantity decimal(18,4),unit_price decimal(18,4),is_foc bit,unit_cost decimal(18,4),
        coupon_discount decimal(18,4),discount_percent decimal(18,4),discount_amount decimal(18,4));
      INSERT dbo.stores VALUES('A','Airport','A',1),('B','Town','B',1);
      INSERT dbo.products VALUES('00000000-0000-4000-8000-000000000001','Fixture',40);
      INSERT dbo.sales VALUES
        ('00000000-0000-4000-8000-000000000010','A','2026-11-01T00:01:00.0000001',98.95,9,-0.05,0,'Airport',0,0),
        ('00000000-0000-4000-8000-000000000011','A','2026-11-01T00:02:00',-20,0,0,0,'Airport',0,0),
        ('00000000-0000-4000-8000-000000000012','A','2026-11-01T00:03:00',0,0,0,0,'Airport',0,0),
        ('00000000-0000-4000-8000-000000000013','A','2026-11-01T00:04:00',10,0,0,0,'Airport',0,0),
        ('00000000-0000-4000-8000-000000000014','A','2026-11-01T00:05:00',999,0,0,1,'Airport',0,0),
        ('00000000-0000-4000-8000-000000000015','B','2026-11-01T00:05:00',999,0,0,0,'Town',0,0),
        ('00000000-0000-4000-8000-000000000016','A','2026-10-31T15:59:59.9999999',999,0,0,0,'Airport',0,0),
        ('00000000-0000-4000-8000-000000000017','A','2026-11-01T16:00:00',999,0,0,0,'Airport',0,0);
      INSERT dbo.sale_items VALUES
        (NEWID(),'00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000001','Normal',1,100,0,40,0,0,0),
        (NEWID(),'00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000001','Return',-1,20,0,10,0,0,0),
        (NEWID(),'00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000001','Free',1,10,1,5,0,0,0),
        (NEWID(),'00000000-0000-4000-8000-000000000013','00000000-0000-4000-8000-000000000001','Captured zero',1,10,0,0,0,0,0);`);
    const result = await readAnalytics(fixture.manager, "A", "2026-11-01", "2026-11-01", "Asia/Brunei", { canViewHourlyCost: () => true });
    assert.deepEqual(result.hourlyRows, [{ store_id: "A", hour: 8, bills: 4, revenue: 80, cost: 35, profit: 45 }]);
    assert.equal(result.bills.length, 4); assert.equal(result.storeDays.length, 1);
    assert.equal(result.storeDays[0].revenue, 80); assert.equal(result.storeDays[0].cost, 35);
    const denied = await readAnalytics(fixture.manager, "A", "2026-11-01", "2026-11-01", "Asia/Brunei", { canViewHourlyCost: true });
    assert(!Object.hasOwn(denied, "hourlyRows"));
    assert.deepEqual(denied.storeDays, result.storeDays); assert.deepEqual(denied.bills, result.bills);
    const foreign = await readAnalytics(fixture.manager, "B", "2026-11-01", "2026-11-01", "Asia/Brunei", { canViewHourlyCost: () => true });
    assert.deepEqual(foreign.hourlyRows, [{ store_id: "B", hour: 8, bills: 1, revenue: 999, cost: 0, profit: 999 }]);
    const utc = await readAnalytics(fixture.manager, "A", "2026-11-01", "2026-11-01", "UTC", { canViewHourlyCost: () => true });
    assert.equal(utc.hourlyRows[0].hour, 0);
    assert.equal((await fixture.pool.request().query("SELECT count(*) n FROM dbo.sales")).recordset[0].n, 8);
    console.log("PASS actual LocalDB hourly read: scope, timezone boundaries, refunds, signed exchange/FOC/zero cost, daily parity, denied flag, no business rewrites.");
  } finally { await fixture.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
