// Opt-in disposable LocalDB only. Never reads POS_Local, credentials or profiles.
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const {execFileSync}=require('node:child_process');
const sql=require('mssql/msnodesqlv8');
const {loadRegistry}=require('../electron/db/schema-registry.cjs');
const {projection}=require('../electron/sync/shift-recovery-exact.cjs');
const root=join(__dirname,'..'),artifact=readFileSync(join(root,'scripts/maintenance/mirror-three-str1-shift-summaries.sql'),'utf8');
const trigger=JSON.parse(readFileSync(join(root,'src/lib/__tests__/fixtures/local54-shifts-unfinished-tickets.live.json'),'utf8')).definition;
const names=['shifts','shift_cash_counts','shift_reconciliations','shift_close_events','shift_notifications','shift_variance_alerts'];
const registry=loadRegistry(),tables=names.map(n=>registry.tables.find(t=>t.cloudTable===n));
const branch='a611a328-2217-4d77-944a-5f6a637d123b',fourth='f7c9512a-92dc-4f88-b49d-71d55c577670';
const nvar=name=>artifact.match(new RegExp('DECLARE @'+name+" nvarchar\\(max\\)=N'((?:[^']|'')*)';"))[1].replaceAll("''","'");
const targets=JSON.parse(nvar('TargetJson')),sourceExpected=JSON.parse(nvar('Expected'));
const amounts=new Map(targets.map((t,i)=>[t.id,{expected_cash:String(100+i*100),expected_card:String(10+i),expected_digital:'20',variance_cash:i===1?'5':'0',variance_total:i===1?'5':'0'}]));
const stamp7=text=>text.replace(/\.(\d+)(?:Z|\+00:00)$/,(_,fraction)=>'.'+fraction.padEnd(7,'0')+'Z');
const quote=v=>"N'"+String(v).replaceAll("'","''")+"'";
function signature(table,row){const cells=table.columns.map(c=>{let v=row[c.sqlServerColumn];if(v==null)return c.sqlServerColumn+'=N';if(c.cloudType==='uuid')v=String(v).toLowerCase();else if(c.cloudType==='boolean')v=v===true||v===1?'1':'0';else v=String(v);return c.sqlServerColumn+'=V'+v.length+':'+v;});return createHash('sha256').update(Buffer.from(table.cloudTable+'|'+cells.join('|'),'utf16le')).digest('hex').toUpperCase();}
async function main(){
 assert.deepEqual(process.argv.slice(2),['--run']);assert.equal(process.platform,'win32');
 assert.equal(createHash('sha256').update(Buffer.from(trigger,'utf16le')).digest('hex').toUpperCase(),'3BB304E7D93DD5F747133EF3FE5CF558C61D4CFBF4A5603B3001295F365C4949');
 const suffix=randomUUID().replaceAll('-',''),instance='CodexLocal54_'+suffix,database='Local54Fixture_'+suffix;
 assert(/^CodexLocal54_[a-f0-9]{32}$/.test(instance)&&/^Local54Fixture_[a-f0-9]{32}$/.test(database));
 const control=(...args)=>{const b=execFileSync('C:/Program Files/Microsoft SQL Server/170/Tools/Binn/SqlLocalDB.exe',args,{windowsHide:true,timeout:30000,stdio:'pipe'});return b.toString(b.includes(0)?'utf16le':'utf8').replace(/^\uFEFF/,'');};
 let owned=false,created=false,server,master,pool,other,passed=0;
 const connect=name=>{assert(name==='master'||name===database);return new sql.ConnectionPool({connectionString:`Driver={ODBC Driver 18 for SQL Server};Server=${server};Database=${name};Trusted_Connection=Yes;Encrypt=No;TrustServerCertificate=Yes;`,options:{trustedConnection:true},pool:{min:0,max:4},requestTimeout:15000}).connect();};
 const test=async(name,fn)=>{await fn();passed++;console.log('PASS '+name);};
 try{
  control('create',instance,'-s');owned=true;server=control('info',instance).match(/np:\\\\\.\\pipe\\LOCALDB#[A-Fa-f0-9]+\\tsql\\query/)?.[0];assert(server,'Owned private pipe unavailable');
  master=await connect('master');await master.request().batch(`CREATE DATABASE [${database}];`);created=true;
  await master.request().batch(`ALTER DATABASE [${database}] SET CHANGE_TRACKING=ON(CHANGE_RETENTION=2 DAYS,AUTO_CLEANUP=ON);`);
  pool=await connect(database);other=await connect(database);
  for(const table of tables){await pool.request().batch(`CREATE TABLE dbo.[${table.sqlServerTable}](${table.columns.map(c=>`[${c.sqlServerColumn}] ${c.sqlServerType} ${c.nullable?'NULL':'NOT NULL'}`).join(',')},PRIMARY KEY(id));ALTER TABLE dbo.[${table.sqlServerTable}] ENABLE CHANGE_TRACKING;`);}
  for(const name of names.slice(1))await pool.request().batch(`ALTER TABLE dbo.[${name}] ADD CONSTRAINT FK_${name}_parent FOREIGN KEY(shift_id) REFERENCES dbo.shifts(id) ON DELETE CASCADE;`);
  await pool.request().batch(`CREATE TABLE dbo.held_orders(store_id nvarchar(450),shift_id nvarchar(128),status nvarchar(40));
   CREATE TABLE dbo.local_operation_receipts(operation_id uniqueidentifier PRIMARY KEY,operation_type nvarchar(40) NOT NULL,entity_id nvarchar(128) NOT NULL,note nvarchar(400),committed_at datetimeoffset(7) NOT NULL DEFAULT SYSDATETIMEOFFSET());
   CREATE TABLE dbo.sync_change_journal(change_id bigint IDENTITY PRIMARY KEY,entity_type nvarchar(128),entity_id nvarchar(400),operation nvarchar(16),branch_id nvarchar(128),acknowledged_at datetimeoffset(7));
   CREATE TABLE dbo.pos_sync_shift_intents(intent_id uniqueidentifier PRIMARY KEY,branch_id nvarchar(128),shift_id uniqueidentifier,acknowledged_at datetimeoffset(7));
   CREATE TABLE dbo.sync_checkpoints(branch_id nvarchar(128),entity_type nvarchar(128),direction nvarchar(10),change_tracking_version bigint,committed_cursor nvarchar(400));
   INSERT dbo.sync_checkpoints VALUES('${branch}','shifts','push',1,'preserve-cursor');
   CREATE TABLE dbo.fixture_stock(id int PRIMARY KEY,quantity decimal(38,12));INSERT dbo.fixture_stock VALUES(1,37);
   CREATE TABLE dbo.fixture_sales(id int PRIMARY KEY,total decimal(38,12));INSERT dbo.fixture_sales VALUES(1,123);`);
  await pool.request().batch(trigger);
  const identity=(await pool.request().query(`SELECT UPPER(CONVERT(nvarchar(128),SERVERPROPERTY('ServerName'))) server_name,CONVERT(nvarchar(36),database_guid) database_guid FROM sys.database_recovery_status WHERE database_id=DB_ID();`)).recordset[0];
  assert.notEqual(identity.database_guid.toUpperCase(),'CEAFA630-D613-423C-8997-8A31DF70C506');
  const row=table=>Object.fromEntries(table.columns.map(c=>[c.sqlServerColumn,c.sqlServerColumn==='id'?randomUUID():c.nullable?null:c.cloudType==='uuid'?randomUUID():/^(numeric|decimal|integer|bigint|smallint)/.test(c.cloudType)?'0':c.cloudType==='boolean'?false:/^timestamp/.test(c.cloudType)?'2026-01-01T00:00:00.1234567Z':c.cloudType==='date'?'2026-01-01':c.cloudType==='jsonb'?'{}':c.cloudType.endsWith('[]')?'[]':'fixture']));
  const insert=async(table,r)=>{const req=pool.request();table.columns.forEach((c,i)=>req.input('fixtureValue'+i,r[c.sqlServerColumn]));await req.query(`INSERT dbo.[${table.sqlServerTable}](${table.columns.map(c=>'['+c.sqlServerColumn+']').join(',')}) VALUES(${table.columns.map((_,i)=>'@fixtureValue'+i).join(',')});`);};
  const seed=async()=>{
   await pool.request().batch(`DELETE dbo.local_operation_receipts;DELETE dbo.sync_change_journal;DELETE dbo.pos_sync_shift_intents;DELETE dbo.held_orders;DELETE dbo.shifts;`);
   for(const target of targets){const money=amounts.get(target.id);const p={...row(tables[0]),id:target.id,store_id:branch,note:'fixture雪😀 | value=V2:x  ',opening_float:'9007199254740993.000000000001',status:'CLOSED',state:'CLOSED',row_version:5,updated_at:target.old_updated_at,closed_at:'2026-10-01T08:00:00.1234567Z',counted_cash:String(Number(money.expected_cash)+Number(money.variance_cash)),final_counted_cash:String(Number(money.expected_cash)+Number(money.variance_cash)),counted_card:money.expected_card,counted_digital:money.expected_digital,variance_card:'0',variance_digital:'0',variance_status:money.variance_total==='0'?'NO_VARIANCE':'OVER',expected_cash:null,expected_card:null,expected_digital:null,variance_cash:null,variance_total:null};await insert(tables[0],p);
    const c={...row(tables[1]),store_id:branch,shift_id:target.id,kind:'ORIGINAL',counted_cash:p.counted_cash,counted_card:p.counted_card,counted_digital:p.counted_digital};await insert(tables[1],c);
    const r={...row(tables[2]),id:target.reconciliation_id,store_id:branch,shift_id:target.id,count_id:c.id,counted_cash:p.counted_cash,counted_card:p.counted_card,counted_digital:p.counted_digital,...money,variance_card:'0',variance_digital:'0',variance_status:p.variance_status};await insert(tables[2],r);
    for(const table of tables.slice(3))await insert(table,{...row(table),store_id:branch,shift_id:target.id,...(table.cloudTable==='shift_variance_alerts'?{reconciliation_id:r.id}:{} )});
   }
   await insert(tables[0],{...row(tables[0]),id:fourth,store_id:branch,status:'OPEN',state:'ACTIVE',row_version:1,closed_at:null});
   await pool.request().query(`INSERT dbo.held_orders VALUES('${branch}','${fourth}','held');`);
  };
  const snapshot=async()=>{const result={};for(const table of tables)result[table.cloudTable]=(await pool.request().query(`SELECT ${projection(table)} FROM dbo.[${table.sqlServerTable}] source ORDER BY CONVERT(nvarchar(36),id);`)).recordset;for(const name of ['local_operation_receipts','sync_change_journal','pos_sync_shift_intents','sync_checkpoints','held_orders','fixture_stock','fixture_sales'])result[name]=(await pool.request().query(`SELECT * FROM dbo.[${name}];`)).recordset;return result;};
  const fixtureSql=async()=>{const data=await snapshot(),expected=[];for(const table of tables)for(const r of data[table.cloudTable])if(targets.some(t=>t.id===String(table.cloudTable==='shifts'?r.id:r.shift_id).toLowerCase()))expected.push({table_name:table.cloudTable,id:r.id.toLowerCase(),signature:signature(table,r)});
   const fixtureTargets=targets.map(t=>{const parent=data.shifts.find(r=>r.id.toLowerCase()===t.id),recon=data.shift_reconciliations.find(r=>r.id.toLowerCase()===t.reconciliation_id),after={...parent,row_version:String(t.new_version),updated_at:stamp7(t.new_updated_at)};for(const key of ['expected_cash','expected_card','expected_digital','variance_cash','variance_total'])after[key]=recon[key];return {...t,expected_after_signature:signature(tables[0],after)};});
   const result=artifact.replace("N'LAPTOP-N0QBONGL\\LCRPOS'",quote(identity.server_name)).replace("DB_NAME()<>N'POS_Local'",'DB_NAME()<>'+quote(database)).replace("'CEAFA630-D613-423C-8997-8A31DF70C506'","'"+identity.database_guid+"'").replace(quote(JSON.stringify(sourceExpected)),quote(JSON.stringify(expected))).replace(quote(JSON.stringify(targets)),quote(JSON.stringify(fixtureTargets)));
   assert.notEqual(result,artifact);assert.equal(result.replace(quote(identity.server_name),"N'LAPTOP-N0QBONGL\\LCRPOS'").replace('DB_NAME()<>'+quote(database),"DB_NAME()<>N'POS_Local'").replace("'"+identity.database_guid+"'","'CEAFA630-D613-423C-8997-8A31DF70C506'").replace(quote(JSON.stringify(expected)),quote(JSON.stringify(sourceExpected))).replace(quote(JSON.stringify(fixtureTargets)),quote(JSON.stringify(targets))),artifact,'Only explicit isolated identities/row fingerprints may differ');return result;};
  const rejects=async(text,pattern)=>{const before=await snapshot();await assert.rejects(pool.request().batch(text),pattern);assert.deepEqual(await snapshot(),before);};
  await seed();let text=await fixtureSql();
  await test('production artifact refuses disposable database without writes',()=>rejects(artifact,/wrong server\/database/));
  await test('exact mirror changes only7fields on3parents, CLOUD CT,one receipt and no other business work',async()=>{
   const before=await snapshot(),ct=(await pool.request().query('SELECT CHANGE_TRACKING_CURRENT_VERSION() v;')).recordset[0].v;
   await pool.request().batch(text);const after=await snapshot();
   for(const name of names.slice(1))assert.deepEqual(after[name],before[name]);for(const name of ['sync_change_journal','pos_sync_shift_intents','sync_checkpoints','held_orders','fixture_stock','fixture_sales'])assert.deepEqual(after[name],before[name]);
   for(const r of after.shifts){const t=targets.find(t=>t.id===r.id.toLowerCase()),old=before.shifts.find(x=>x.id===r.id);if(!t){assert.deepEqual(r,old);continue;}const unchanged={...r};for(const key of ['expected_cash','expected_card','expected_digital','variance_cash','variance_total','row_version','updated_at'])delete unchanged[key];const oldUnchanged={...old};for(const key of ['expected_cash','expected_card','expected_digital','variance_cash','variance_total','row_version','updated_at'])delete oldUnchanged[key];assert.deepEqual(unchanged,oldUnchanged);assert.equal(r.row_version,'6');assert.equal(r.updated_at,stamp7(t.new_updated_at));for(const key of ['expected_cash','expected_card','expected_digital','variance_cash','variance_total'])assert.equal(Number(r[key]),Number(amounts.get(t.id)[key]));}
   assert.equal(after.local_operation_receipts.length,1);const receipt=after.local_operation_receipts[0];assert.equal(receipt.operation_type,'cloud_shift_summary_mirror');assert(JSON.parse(receipt.note).u);const changed=(await pool.request().input('since',ct).query(`SELECT CT.SYS_CHANGE_CONTEXT context,CT.SYS_CHANGE_OPERATION operation,CT.id FROM CHANGETABLE(CHANGES dbo.shifts,@since) CT;`)).recordset;assert.equal(changed.length,3);assert(changed.every(c=>c.operation==='U'&&c.context.equals(Buffer.from('CLOUD'))));
  });
  await test('exact replay performs no business or metadata writes',async()=>{const before=await snapshot();await pool.request().batch(text);assert.deepEqual(await snapshot(),before);});
  await test('forged replay cannot bless changed children or immutable facts',async()=>{await pool.request().query(`UPDATE dbo.shift_cash_counts SET reason=N'tampered' WHERE shift_id='${targets[0].id}';`);await rejects(text,/replay original facts changed/);});
  for(const [name,mutation,pattern] of [
   ['changed parent note',`UPDATE dbo.shifts SET note=N'changed' WHERE id='${targets[0].id}'`,/before-image/],
   ['changed count child',`UPDATE dbo.shift_cash_counts SET counted_cash=99 WHERE shift_id='${targets[0].id}'`,/before-image/],
   ['changed microsecond clock',`UPDATE dbo.shifts SET updated_at=DATEADD(nanosecond,100,updated_at) WHERE id='${targets[0].id}'`,/before-image/],
   ['pending unknown journal',`INSERT dbo.sync_change_journal(entity_type,entity_id,branch_id) VALUES('shift_cash_counts','unknown','global')`,/pending closing/],
   ['pending author intent',`INSERT dbo.pos_sync_shift_intents VALUES(NEWID(),'${branch}','${targets[0].id}',NULL)`,/pending closing/],
  ])await test(name+' aborts unchanged',async()=>{await seed();text=await fixtureSql();await pool.request().batch(mutation);await rejects(text,pattern);});
  await test('receipt insertion failure rolls back all3updates',async()=>{await seed();text=await fixtureSql();await pool.request().query(`ALTER TABLE dbo.local_operation_receipts ADD CONSTRAINT fixture_receipt_failure CHECK(operation_type<>N'cloud_shift_summary_mirror');`);await rejects(text,/CHECK constraint/);await pool.request().query('ALTER TABLE dbo.local_operation_receipts DROP CONSTRAINT fixture_receipt_failure;');});
  await test('unexpected trigger aborts before updates',async()=>{await seed();text=await fixtureSql();await pool.request().batch(`CREATE TRIGGER dbo.fixture_extra ON dbo.shifts AFTER UPDATE AS BEGIN RETURN;END;`);await rejects(text,/trigger definition/);await pool.request().query('DROP TRIGGER dbo.fixture_extra;');});
  await test('disabled required trigger aborts before updates',async()=>{await seed();text=await fixtureSql();await pool.request().query('DISABLE TRIGGER dbo.shifts_unfinished_tickets ON dbo.shifts;');try{await rejects(text,/trigger definition/);}finally{await pool.request().query('ENABLE TRIGGER dbo.shifts_unfinished_tickets ON dbo.shifts;');}});
  await test('receipt uniqueness drift and missing audit keys abort',async()=>{await seed();text=await fixtureSql();const key=(await pool.request().query(`SELECT name FROM sys.key_constraints WHERE parent_object_id=OBJECT_ID(N'dbo.local_operation_receipts');`)).recordset[0].name;await pool.request().query(`ALTER TABLE dbo.local_operation_receipts DROP CONSTRAINT [${key.replaceAll(']',']]')}];`);await rejects(text,/receipt identity constraint/);await pool.request().query('ALTER TABLE dbo.local_operation_receipts ADD PRIMARY KEY(operation_id);');await pool.request().batch(text);await pool.request().query(`UPDATE dbo.local_operation_receipts SET note=JSON_MODIFY(note,'$.b',NULL);`);await rejects(text,/replay receipt/);});
  await test('metadata changed after identity precheck is rejected and its DDL rolls back',async()=>{await seed();text=await fixtureSql();await rejects(text.replace(' BEGIN TRANSACTION;'," BEGIN TRANSACTION; EXEC(N'CREATE TRIGGER dbo.fixture_raced ON dbo.shifts AFTER UPDATE AS BEGIN RETURN;END;');"),/trigger definition/);assert.equal((await pool.request().query("SELECT OBJECT_ID(N'dbo.fixture_raced') id;")).recordset[0].id,null);});
  await test('post-DML metadata recheck rolls back unknown transactional trigger effects',async()=>{await seed();text=await fixtureSql();await rejects(text.replace(' WITH CHANGE_TRACKING_CONTEXT(0x434C4F5544) UPDATE'," EXEC(N'CREATE TRIGGER dbo.fixture_late ON dbo.shifts AFTER UPDATE AS BEGIN UPDATE dbo.fixture_stock SET quantity=999;END;'); WITH CHANGE_TRACKING_CONTEXT(0x434C4F5544) UPDATE"),/trigger definition/);assert.equal(Number((await snapshot()).fixture_stock[0].quantity),37);});
  await test('real concurrent DDL is blocked or detected without unchecked stock effects',async()=>{await seed();text=await fixtureSql();const before=await snapshot();let ready;const signal=new Promise(resolve=>{ready=resolve;});const req=pool.request();req.on('info',info=>{if(info.message.includes('LOCAL54_FIXTURE_LOCKED'))ready();});const pending=req.batch(text.replace(' WITH CHANGE_TRACKING_CONTEXT(0x434C4F5544) UPDATE'," RAISERROR('LOCAL54_FIXTURE_LOCKED',10,1) WITH NOWAIT; WAITFOR DELAY '00:00:02'; WITH CHANGE_TRACKING_CONTEXT(0x434C4F5544) UPDATE")).then(()=>({}),error=>({error}));await signal;await other.request().batch(`CREATE TRIGGER dbo.fixture_external ON dbo.shifts AFTER UPDATE AS BEGIN UPDATE dbo.fixture_stock SET quantity=999;END;`);const result=await pending;if(result.error){assert.match(result.error.message,/trigger definition/);assert.deepEqual(await snapshot(),before);}else{assert.equal((await snapshot()).local_operation_receipts.length,1);}assert.equal(Number((await snapshot()).fixture_stock[0].quantity),37);await pool.request().query('DROP TRIGGER dbo.fixture_external;');});
  await test('real independent locked parent aborts promptly and preserves data',async()=>{await seed();text=await fixtureSql();const tx=new sql.Transaction(other);await tx.begin();try{await tx.request().query(`SELECT id FROM dbo.shifts WITH(UPDLOCK,HOLDLOCK) WHERE id='${targets[0].id}';`);await assert.rejects(pool.request().batch(text),/Lock request time out|1222/i);}finally{await tx.rollback();}assert.equal((await snapshot()).local_operation_receipts.length,0);});
  await test('caller transaction is neither committed nor rolled back',async()=>{await seed();text=await fixtureSql();const tx=new sql.Transaction(pool);await tx.begin();try{await tx.request().query(`UPDATE dbo.fixture_stock SET quantity=38 WHERE id=1;`);await assert.rejects(tx.request().batch(text),/requires its own transaction/);assert.equal((await tx.request().query('SELECT XACT_STATE() state;')).recordset[0].state,1);}finally{await tx.rollback();}assert.equal(Number((await snapshot()).fixture_stock[0].quantity),37);});
  console.log('PASS '+passed+' actual isolated LOCAL54 SQLServer groups');
 }finally{
  await other?.close().catch(()=>{});await pool?.close().catch(()=>{});
  if(master&&created){assert(/^Local54Fixture_[a-f0-9]{32}$/.test(database));await master.request().batch(`ALTER DATABASE [${database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;DROP DATABASE [${database}];`);}await master?.close().catch(()=>{});
  if(owned){control('stop',instance,'-k');control('delete',instance);}console.log('Cleaned owned fixture '+instance+' / '+database);
 }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
