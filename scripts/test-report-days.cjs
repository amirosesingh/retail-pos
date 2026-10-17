const { test }=require("node:test");
const assert=require("node:assert/strict");
const {reportDays}=require("../electron/db/report-days.cjs");
test("Singapore day uses its UTC boundaries rather than the PC clock",()=>{
  assert.deepEqual(reportDays("2026-10-17","2026-10-17","Asia/Singapore"),[{day:"2026-10-17",start:"2026-10-16T16:00:00.000Z",end:"2026-10-17T16:00:00.000Z"}]);
});
test("daylight saving transitions have correct 23 and 25 hour windows",()=>{
  const spring=reportDays("2026-03-08","2026-03-08","America/New_York")[0];
  const autumn=reportDays("2026-11-01","2026-11-01","America/New_York")[0];
  assert.equal(Date.parse(spring.end)-Date.parse(spring.start),23*3600000);
  assert.equal(Date.parse(autumn.end)-Date.parse(autumn.start),25*3600000);
});
test("fractional offsets and month boundaries are supported",()=>{
  const rows=reportDays("2026-01-31","2026-02-01","Asia/Kolkata");
  assert.equal(rows.length,2);assert.equal(rows[0].start,"2026-01-30T18:30:00.000Z");assert.equal(rows[0].end,rows[1].start);
});
test("invalid dates, zones and excessive ranges are rejected",()=>{
  assert.throws(()=>reportDays("2026-02-30","2026-03-01"));
  assert.throws(()=>reportDays("2026-10-17","2026-10-16"));
  assert.throws(()=>reportDays("2026-10-17","2026-10-17","unknown"));
  assert.throws(()=>reportDays("2000-01-01","2026-01-01"),/ten years/);
});
test("native report binds its branch and business days without interpolating either into SQL",async()=>{
  const {readAnalytics}=require("../electron/db/repositories/analytics.cjs");
  const inputs={}; let query="";
  const request={input(name,value){inputs[name]=value;return this;},async query(sql){query=sql;return {recordsets:[[],[],[],[]]};}};
  assert.equal((await readAnalytics({pool:{request:()=>request}},"branch-a","2026-10-17","2026-10-17","Asia/Singapore")).ok,true);
  assert.equal(inputs.branch,"branch-a");assert.equal(JSON.parse(inputs.days)[0].start,"2026-10-16T16:00:00.000Z");
  assert.ok(query.includes("s.store_id=@branch"));assert.ok(query.includes("COALESCE(s.is_refunded,0)=0"));assert.ok(!query.includes("branch-a"));
});
