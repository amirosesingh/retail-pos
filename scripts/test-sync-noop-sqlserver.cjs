// Opt-in owned disposable LocalDB only; never opens POS_Local or a saved profile.
const assert=require("node:assert/strict");
const {randomUUID}=require("node:crypto");
const {execFileSync}=require("node:child_process");
const sql=require("mssql/msnodesqlv8");
const {CloudClient}=require("../electron/sync/cloud-client.cjs");
async function main(){
 assert.deepEqual(process.argv.slice(2),["--run"]);
 const suffix=randomUUID().replaceAll("-",""),instance="CodexNoop_"+suffix,database="NoopFixture_"+suffix;
 const control=(...args)=>{const o=execFileSync("C:/Program Files/Microsoft SQL Server/170/Tools/Binn/SqlLocalDB.exe",args,{windowsHide:true,timeout:30000});return o.toString(o.includes(0)?"utf16le":"utf8").replace(/^\uFEFF/,"");};
 let owned=false,created=false,master,pool,other,server,passed=0;
 const connect=name=>new sql.ConnectionPool({connectionString:`Driver={ODBC Driver 18 for SQL Server};Server=${server};Database=${name};Trusted_Connection=Yes;Encrypt=No;TrustServerCertificate=Yes;`,pool:{min:0,max:3},requestTimeout:10000}).connect();
 try{
  control("create",instance,"-s");owned=true;server=control("info",instance).match(/np:\\\\\.\\pipe\\LOCALDB#[A-Fa-f0-9]+\\tsql\\query/)?.[0];assert(server);
  master=await connect("master");await master.request().batch(`CREATE DATABASE [${database}];ALTER DATABASE [${database}] SET CHANGE_TRACKING=ON(CHANGE_RETENTION=2 DAYS,AUTO_CLEANUP=ON);`);created=true;pool=await connect(database);
  await pool.request().batch("CREATE TABLE dbo.fixture(id uniqueidentifier NOT NULL PRIMARY KEY,label nvarchar(64) NULL,note nvarchar(max) NULL,amount decimal(18,4) NULL,stamp datetimeoffset(7) NULL,flag bit NULL,row_version int NOT NULL,owner_store_id nvarchar(128) NULL,stock_by_store nvarchar(max) NULL);ALTER TABLE dbo.fixture ENABLE CHANGE_TRACKING;CREATE TABLE dbo.trigger_stats(statement_count int NOT NULL,changed_rows int NOT NULL);INSERT dbo.trigger_stats VALUES(0,0);");
  await pool.request().batch("CREATE TRIGGER dbo.fixture_update ON dbo.fixture AFTER UPDATE AS BEGIN SET NOCOUNT ON;UPDATE dbo.trigger_stats SET statement_count=statement_count+1,changed_rows=changed_rows+(SELECT COUNT(*) FROM inserted);END;");
  const types={id:"uniqueidentifier",label:"nvarchar(64)",note:"nvarchar(max)",amount:"decimal(18,4)",stamp:"datetimeoffset(7)",flag:"bit",row_version:"int",owner_store_id:"nvarchar(128)",stock_by_store:"nvarchar(max)"};
  const table={cloudTable:"fixture",sqlServerTable:"fixture",conflictRule:"highest_version",columns:Object.entries(types).map(([name,type])=>({cloudColumn:name,sqlServerColumn:name,sqlServerType:type,cloudType:name==="stock_by_store"?"jsonb":"text",primaryKey:name==="id"}))};
  const cm={pool,sql:()=>sql},client=new CloudClient({connectionManager:cm});
  const id=randomUUID(),base={id,label:"Case ",note:null,amount:"1.0000",stamp:"2026-01-02T03:04:05.1234567+08:00",flag:false,row_version:1,owner_store_id:null,stock_by_store:{branch:0}};
  const apply=async(row,custom=table,transaction)=>{const tx=transaction??new sql.Transaction(pool);if(!transaction)await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);try{await client.applyLocalBatch(tx,custom,{rows:[{entity_id:JSON.stringify({id:row.id}),row_data:row}],tombstones:[]});if(!transaction)await tx.commit();}catch(e){if(!transaction)await tx.rollback().catch(()=>{});throw e;}};
  const version=async()=>(await pool.request().query("SELECT CHANGE_TRACKING_CURRENT_VERSION() v;")).recordset[0].v;
  const stats=async()=>(await pool.request().query("SELECT * FROM dbo.trigger_stats;")).recordset[0];
  const read=async()=>(await pool.request().query("SELECT CONVERT(nvarchar(max),(SELECT id,label,note,CONVERT(varchar(50),amount) amount,CONVERT(nvarchar(40),stamp,127) stamp,flag,row_version,owner_store_id,stock_by_store FROM dbo.fixture ORDER BY id FOR JSON PATH,INCLUDE_NULL_VALUES)) data;")).recordset[0].data;
  const test=async(name,run)=>{await run();passed++;console.log("PASS "+name);};
  await test("insert then identical equal-version replay produces no tracked row update",async()=>{await apply(base);const v=await version(),s=await stats(),before=await read();await apply(base);assert.equal(await version(),v);assert.equal((await stats()).changed_rows,s.changed_rows);assert.equal(await read(),before);assert((await stats()).statement_count>=s.statement_count,"SQL statement triggers may still execute");});
  await test("equal version repairs case, trailing spaces, Unicode, NUL bytes and NULL changes",async()=>{for(const label of ["case ","case","case\u0000","é字 ",null,"Case "]){const s=await stats();await apply({...base,label});assert((await stats()).changed_rows>s.changed_rows);}await apply(base);});
  await test("decimal persisted rounding and full 100ns timestamp compare correctly",async()=>{let v=await version();await apply({...base,amount:"1.000049"});assert.equal(await version(),v);await apply({...base,stamp:"2026-01-02T03:04:05.1234568+08:00"});assert((await version())>v);v=await version();await apply({...base,stamp:"2026-01-01T19:04:05.1234568+00:00"});assert((await version())>v);await apply(base);});
  await test("owner and JSON bytes repair without a row-version shortcut",async()=>{for(const patch of [{owner_store_id:"other"},{stock_by_store:{branch:1}}]){const before=await read(),s=await stats();await apply({...base,...patch});assert.notEqual(await read(),before);assert((await stats()).changed_rows>s.changed_rows);await apply(base);}});
  await test("oversized bounded text and decimal overflow still fail atomically",async()=>{const before=await read();for(const patch of [{label:"x".repeat(65)},{amount:"999999999999999999999999999"}])await assert.rejects(apply({...base,...patch}));assert.equal(await read(),before);});
  await test("older versions retain authorization ordering even for invalid source conversions",async()=>{const before=await read();await apply({...base,row_version:0,label:"stale",amount:"not-a-number"});assert.equal(await read(),before);});
  await test("unknown registry type conservatively retains original UPDATE",async()=>{const unknown={...table,columns:table.columns.map(c=>c.cloudColumn==="label"?{...c,sqlServerType:"unknown-type"}:c)};const s=await stats();await apply(base,unknown);assert((await stats()).changed_rows>s.changed_rows);});
  await pool.request().batch("ALTER TABLE dbo.fixture ADD is_refunded bit NULL,refunded_qty decimal(18,4) NULL,corrected_at datetimeoffset(7) NULL;");
  const receiptColumns=[...table.columns,...Object.entries({is_refunded:"bit",refunded_qty:"decimal(18,4)",corrected_at:"datetimeoffset(7)"}).map(([name,type])=>({cloudColumn:name,sqlServerColumn:name,sqlServerType:type,cloudType:"text"}))];
  await test("refund OR/MAX assignments skip identical effective values and preserve monotonic refunds",async()=>{
    const sales={...table,cloudTable:"sales",columns:receiptColumns};
    const row={...base,id:randomUUID(),is_refunded:false,corrected_at:null};await apply(row,sales);
    let s=await stats();await apply({...row,label:"ignored immutable field"},sales);assert.equal((await stats()).changed_rows,s.changed_rows);
    await apply({...row,row_version:0,is_refunded:true},sales);s=await stats();await apply({...row,row_version:0,is_refunded:false},sales);assert.equal((await stats()).changed_rows,s.changed_rows);
    const items={...table,cloudTable:"sale_items",columns:receiptColumns},item={...base,id:randomUUID(),refunded_qty:"2.0000"};await apply(item,items);s=await stats();await apply({...item,row_version:0,refunded_qty:"1.0000"},items);assert.equal((await stats()).changed_rows,s.changed_rows);await apply({...item,row_version:0,refunded_qty:"3.0000"},items);assert((await stats()).changed_rows>s.changed_rows);
  });
  await test("authorized receipt correction still repairs fields and identical replay does not update",async()=>{
    const sales={...table,cloudTable:"sales",columns:receiptColumns},row={...base,id:randomUUID(),is_refunded:false,corrected_at:null};await apply(row,sales);
    const correction={...row,label:"corrected",amount:"2.0000",row_version:2,corrected_at:"2026-01-03T00:00:00.0000000Z"};let s=await stats();await apply(correction,sales);assert((await stats()).changed_rows>s.changed_rows);s=await stats();await apply(correction,sales);assert.equal((await stats()).changed_rows,s.changed_rows);
  });
  await test("empty company identity fallback still repairs a newer local default once",async()=>{
    await pool.request().batch("CREATE TABLE dbo.pos_settings(id int NOT NULL PRIMARY KEY,company_name nvarchar(64) NULL,updated_at datetimeoffset(7) NULL,row_version int NOT NULL);ALTER TABLE dbo.pos_settings ENABLE CHANGE_TRACKING;INSERT dbo.pos_settings VALUES(1,N'', '2026-02-01T00:00:00Z',5);");
    const settings={cloudTable:"pos_settings",sqlServerTable:"pos_settings",conflictRule:"highest_version",columns:Object.entries({id:"int",company_name:"nvarchar(64)",updated_at:"datetimeoffset(7)",row_version:"int"}).map(([name,type])=>({cloudColumn:name,sqlServerColumn:name,sqlServerType:type,cloudType:"text",primaryKey:name==="id"}))};
    const row={id:1,company_name:"Synthetic company",updated_at:"2026-01-01T00:00:00Z",row_version:4};await apply(row,settings);assert.equal((await pool.request().query("SELECT company_name FROM dbo.pos_settings WHERE id=1;")).recordset[0].company_name,row.company_name);const v=await version();await apply(row,settings);assert.equal(await version(),v);
  });
  await test("a concurrent writer cannot turn no-op comparison into a lost update",async()=>{other=await connect(database);const tx=new sql.Transaction(other);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);try{await new sql.Request(tx).input("id",id).query("UPDATE dbo.fixture SET label=N'concurrent' WHERE id=@id;");const pending=apply({...base,row_version:0,label:"stale"});await new Promise(r=>setTimeout(r,100));await tx.commit();await pending;const saved=JSON.parse(await read()).find(row=>row.id.toLowerCase()===id);assert.equal(saved.label,"concurrent");}catch(e){await tx.rollback().catch(()=>{});throw e;}await apply(base);});
  console.log(passed+" isolated no-op SQL Server groups passed; no claim of zero statement-trigger invocations.");
 }finally{
  await other?.close();await pool?.close();if(created){assert(owned&&/^NoopFixture_[a-f0-9]{32}$/.test(database));await master.request().batch(`ALTER DATABASE [${database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;DROP DATABASE [${database}];`);}await master?.close();if(owned){control("stop",instance,"-k");control("delete",instance);}console.log("Cleaned owned fixture "+instance+" / "+database);
 }
}
main().catch(e=>{console.error(e.message);for(const p of e.precedingErrors??[])console.error(p.message);process.exitCode=1;});
