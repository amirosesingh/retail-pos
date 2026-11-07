// Opt-in isolated LocalDB only. Never reads POS profiles, credentials or POS_Local.
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {randomUUID,createHash} = require('node:crypto');
const sql = require('mssql/msnodesqlv8');
const {loadRegistry} = require('../electron/db/schema-registry.cjs');
const {ChangeReader} = require('../electron/sync/change-reader.cjs');
const {CheckpointRepository} = require('../electron/sync/checkpoints.cjs');
const {ShiftGapRecovery,TABLES} = require('../electron/sync/shift-gap-recovery.cjs');
const {prepareShiftGraphs,applyShiftGraphs} = require('../electron/sync/shift-graph.cjs');
const {projection,parseExactJson,stringifyExactJson,rememberGraph} = require('../electron/sync/shift-recovery-exact.cjs');

async function main(){
  assert.deepEqual(process.argv.slice(2),['--run']);
  assert.equal(process.platform,'win32');
  const suffix=randomUUID().replaceAll('-',''),instance='CodexGap53_'+suffix,database='Gap53Fixture_'+suffix;
  assert(/^CodexGap53_[a-f0-9]{32}$/.test(instance)&&/^Gap53Fixture_[a-f0-9]{32}$/.test(database));
  const control=(...args)=>{const b=execFileSync('C:/Program Files/Microsoft SQL Server/170/Tools/Binn/SqlLocalDB.exe',args,{windowsHide:true,timeout:30000,stdio:'pipe'});return b.toString(b.includes(0)?'utf16le':'utf8').replace(/^\uFEFF/,'');};
  let owned=false,created=false,server,master,pool,other,passed=0;
  const connect=name=>{assert(name==='master'||name===database);return new sql.ConnectionPool({connectionString:`Driver={ODBC Driver 18 for SQL Server};Server=${server};Database=${name};Trusted_Connection=Yes;Encrypt=No;TrustServerCertificate=Yes;`,options:{trustedConnection:true},pool:{min:0,max:4},requestTimeout:10000,connectionTimeout:10000}).connect();};
  const test=async(name,work)=>{await work();passed++;console.log('PASS '+name);};
  try{
    control('create',instance,'-s');owned=true;
    server=control('info',instance).match(/np:\\\\\.\\pipe\\LOCALDB#[A-Fa-f0-9]+\\tsql\\query/)?.[0];
    assert(server,'Owned LocalDB private pipe unavailable');
    master=await connect('master');
    await master.request().batch(`CREATE DATABASE [${database}];`);created=true;
    await master.request().batch(`ALTER DATABASE [${database}] SET CHANGE_TRACKING=ON(CHANGE_RETENTION=2 DAYS,AUTO_CLEANUP=ON);`);
    pool=await connect(database);other=await connect(database);
    const registry={...loadRegistry(),tables:loadRegistry().tables.filter(t=>TABLES.includes(t.cloudTable))};
    assert.equal(registry.tables.length,6);
    for(const name of TABLES){const table=registry.tables.find(t=>t.cloudTable===name);
      await pool.request().batch(`CREATE TABLE dbo.[${name}](${table.columns.map(c=>`[${c.sqlServerColumn}] ${c.sqlServerType} ${c.sqlServerColumn==='id'?'NOT NULL':'NULL'}`).join(',')},PRIMARY KEY(id)); ALTER TABLE dbo.[${name}] ENABLE CHANGE_TRACKING;`);
    }
    for(const name of TABLES.filter(n=>n!=='shifts'))await pool.request().batch(`ALTER TABLE dbo.[${name}] ADD CONSTRAINT [FK_${name}_fixture] FOREIGN KEY(shift_id) REFERENCES dbo.shifts(id) ON DELETE CASCADE;`);
    await pool.request().batch(`CREATE TABLE dbo.sync_change_journal(change_id bigint IDENTITY PRIMARY KEY,entity_type nvarchar(128),entity_id nvarchar(400),operation nvarchar(16),branch_id nvarchar(128),acknowledged_at datetimeoffset NULL);
      CREATE TABLE dbo.pos_sync_shift_intents(intent_id uniqueidentifier PRIMARY KEY,branch_id nvarchar(128),shift_id uniqueidentifier,acknowledged_at datetimeoffset NULL);
      CREATE TABLE dbo.sync_checkpoints(organization_id nvarchar(128),branch_id nvarchar(128),entity_type nvarchar(128),direction nvarchar(10),change_tracking_version bigint,committed_cursor nvarchar(400),updated_at datetimeoffset);
      CREATE UNIQUE INDEX fixture_checkpoint ON dbo.sync_checkpoints(organization_id,branch_id,entity_type,direction);`);
    const branch='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',cm={pool,sql:()=>sql},reader=new ChangeReader(cm,registry),checkpoints=new CheckpointRepository(cm);
    const cloudIdentity={terminalId:()=> 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',backendUrl:()=> 'https://isolated.invalid'};
    const run=(assertSource,requireExpiredCheckpoint=false)=>new ShiftGapRecovery({connectionManager:cm,registry,reader,checkpoints,branchId:branch,tableName:'shifts',cloud:cloudIdentity,historyDays:90,assertSource,requireExpiredCheckpoint});
    const request=()=>pool.request();
    const seed=async()=>{const id=randomUUID();await request().input('id',id).input('branch',branch).query(`INSERT dbo.shifts(id,store_id,status,state,opened_at,row_version,opening_float) VALUES(@id,@branch,'OPEN','ACTIVE','2026-01-01T00:00:00.1234567+00:00',1,648);`);return id;};
    const seedClosed=async()=>{
      const id=await seed(),count=randomUUID(),recon=randomUUID();
      await request().input('id',id).query(`UPDATE dbo.shifts SET status='CLOSED',state='CLOSED',closed_at='2026-01-01T08:00:00.1234567+00:00',
        counted_cash=100,final_counted_cash=100,closing_float=100,counted_card=12,counted_digital=20,expected_cash=100,expected_card=12,expected_digital=20,
        variance_cash=0,variance_card=0,variance_digital=0,variance_total=0,variance_status='NO_VARIANCE' WHERE id=@id;`);
      await request().input('id',id).input('branch',branch).input('count',count).input('recon',recon).batch(`
        INSERT dbo.shift_cash_counts(id,store_id,shift_id,kind,counted_cash,counted_card,counted_digital) VALUES(@count,@branch,@id,'ORIGINAL',100,12,20);
        INSERT dbo.shift_reconciliations(id,store_id,shift_id,count_id,counted_cash,counted_card,counted_digital,expected_cash,expected_card,expected_digital,variance_cash,variance_card,variance_digital,variance_total,variance_status)
          VALUES(@recon,@branch,@id,@count,100,12,20,100,12,20,0,0,0,0,'NO_VARIANCE');
        INSERT dbo.shift_close_events(id,store_id,shift_id) VALUES(NEWID(),@branch,@id);
        INSERT dbo.shift_notifications(id,store_id,shift_id) VALUES(NEWID(),@branch,@id);
        INSERT dbo.shift_variance_alerts(id,store_id,shift_id,reconciliation_id) VALUES(NEWID(),@branch,@id,@recon);`);
      return id;
    };
    const snapshot=async()=>{const parts=[];for(const name of TABLES){const table=registry.tables.find(t=>t.cloudTable===name);parts.push({table:name,rows:(await request().query(`SELECT ${projection(table)} FROM dbo.[${name}] source ORDER BY id;`)).recordset});}return createHash('sha256').update(JSON.stringify(parts)).digest('hex');};
    const graph=async(id)=>{
      const tables=[];
      for(const name of TABLES){const table=registry.tables.find(t=>t.cloudTable===name);const rows=(await request().input('id',id).query(`SELECT ${projection(table)} FROM dbo.[${name}] source WHERE ${name==='shifts'?'id':'shift_id'}=@id ORDER BY id;`)).recordset;
        tables.push({table:name,rows:rows.map(row=>Object.fromEntries(table.columns.map(c=>{let v=row[c.sqlServerColumn];if(v!==null&&(/^(numeric|decimal|money|smallmoney|bigint|integer|smallint|real|double precision)/.test(c.cloudType)||c.cloudType==='jsonb'||c.cloudType.endsWith('[]')))v=parseExactJson(v);return[c.cloudColumn,v];})))});
      }
      const parent=tables[0].rows[0],closed=parent?.status==='CLOSED';
      const raw=stringifyExactJson({ok:true,shiftGraphVersion:parseExactJson('1'),branchId:branch,shiftId:id,graphToken:closed?'a'.repeat(64):null,closedAtRaw:closed?parent.closed_at:null,tables});
      return rememberGraph(JSON.parse(raw),raw,'1');
    };
    const accept=async(recovery,id,incoming)=>{
      const cloud={shiftGraph:async()=>incoming??graph(id)},prepared=await prepareShiftGraphs({cloud,connectionManager:cm,branchId:branch,changes:[{table_name:'shifts',entity_id:JSON.stringify({id}),tombstone:false}]});
      let tx;await recovery.atomic(async t=>{tx=t;assert.equal(await applyShiftGraphs({transaction:t,connectionManager:cm,registry,reader,branchId:branch,prepared,recovery}),0);});recovery.committed(tx);
    };
    const reset=async()=>{await request().batch(`DELETE dbo.sync_change_journal; DELETE dbo.pos_sync_shift_intents; DELETE dbo.sync_checkpoints; DELETE dbo.shifts;`);};
    const noCheckpoint=async()=>assert.equal(await checkpoints.get(branch,'shifts','push'),null);

    await test('real six-table CT exact OPEN no-op preserves business rows and advances only captured V0',async()=>{
      const id=await seed(),before=await snapshot(),recovery=await run().begin();await accept(recovery,id);
      const proof=await recovery.finish();assert.equal(String(proof.currentVersion),recovery.baseline);assert.equal(await snapshot(),before);
      assert.equal(String((await checkpoints.get(branch,'shifts','push')).change_tracking_version),recovery.baseline);
    });
    await reset();
    await test('complete CLOSED six-table graph is read-only and preserves all child records',async()=>{
      const id=await seedClosed(),before=await snapshot(),r=await run().begin();await accept(r,id);await r.finish();assert.equal(await snapshot(),before);
    });
    await reset();
    await test('retained closed parent with missing summaries stays blocked',async()=>{
      const id=await seedClosed(),incoming=await graph(id);await request().input('id',id).query('UPDATE dbo.shifts SET expected_cash=NULL,variance_total=NULL WHERE id=@id;');
      const r=await run().begin(),before=await snapshot();await assert.rejects(accept(r,id,incoming),e=>e.code==='ELOCAL_PENDING_UNVERIFIED');assert.equal(await snapshot(),before);await noCheckpoint();
    });
    await reset();
    await test('whole-branch coverage refuses a retained graph never proved',async()=>{await seed();const r=await run().begin();await assert.rejects(r.finish(),e=>e.code==='ELOCAL_PENDING_UNVERIFIED');await noCheckpoint();});
    await reset();
    await test('retained graph deleted entirely after V0 cannot become a fresh empty bootstrap',async()=>{const id=await seed(),incoming=await graph(id),r=await run().begin();await request().input('id',id).query('DELETE dbo.shifts WHERE id=@id;');await assert.rejects(accept(r,id,incoming),e=>e.code==='ELOCAL_PENDING_UNVERIFIED');await noCheckpoint();});
    await reset();
    await test('post-proof legacy edit retains checkpoint and local value',async()=>{const id=await seed(),r=await run().begin();await accept(r,id);await request().input('id',id).query('UPDATE dbo.shifts SET opening_float=opening_float+1 WHERE id=@id;');await assert.rejects(r.finish(),e=>['ELOCAL_PENDING_UNVERIFIED','ELOCAL_CT_PENDING'].includes(e.code));await noCheckpoint();});
    await reset();
    await test('unknown deleted journal key and author intent deny before any recovery write',async()=>{
      await seed();await request().input('key',JSON.stringify({id:randomUUID()})).input('branch',branch).query("INSERT dbo.sync_change_journal(entity_type,entity_id,operation,branch_id) VALUES('shifts',@key,'D',@branch);");
      await assert.rejects(run().begin(),e=>e.code==='ELOCAL_UPLOAD_PENDING');await noCheckpoint();
      await request().query("UPDATE dbo.sync_change_journal SET branch_id=N' ';");
      await assert.rejects(run().begin(),e=>e.code==='ELOCAL_UPLOAD_PENDING');await noCheckpoint();await request().query('DELETE dbo.sync_change_journal;');
      await request().input('id',randomUUID()).input('shift',randomUUID()).input('branch',branch).query('INSERT dbo.pos_sync_shift_intents(intent_id,branch_id,shift_id) VALUES(@id,@branch,@shift);');
      await assert.rejects(run().begin(),e=>e.code==='ELOCAL_UPLOAD_PENDING');await noCheckpoint();
    });
    await reset();
    await test('raw decimal beyond Number precision cannot prove equality',async()=>{
      const id=await seed(),g=await graph(id);const raw=JSON.stringify(g).replace('"opening_float":648','"opening_float":648.00000000000000000001');assert(raw.includes('648.00000000000000000001'));
      const incoming=rememberGraph(JSON.parse(raw),raw,'1'),r=await run().begin();await assert.rejects(accept(r,id,incoming),e=>e.code==='ELOCAL_PENDING_UNVERIFIED');await noCheckpoint();
    });
    await reset();
    await test('same-millisecond timestamp difference cannot prove equality',async()=>{
      const id=await seed(),g=await graph(id);const raw=JSON.stringify(g).replace('00:00:00.1234567','00:00:00.1234566');assert.notEqual(raw,JSON.stringify(g));
      const r=await run().begin();await assert.rejects(accept(r,id,rememberGraph(JSON.parse(raw),raw,'1')),e=>e.code==='ELOCAL_PENDING_UNVERIFIED');await noCheckpoint();
    });
    await reset();
    await test('checkpoint failure rolls back only metadata and preserves every business fact',async()=>{
      const id=await seed(),r=await run().begin();await accept(r,id);const before=await snapshot();
      r.checkpoints={advanceRecovery:async(...args)=>{await checkpoints.advanceRecovery(...args);throw Error('fixture checkpoint rollback');}};
      await assert.rejects(r.finish(),/fixture checkpoint rollback/);await noCheckpoint();assert.equal(await snapshot(),before);
    });
    await reset();
    await test('source change before commit rolls back the captured checkpoint',async()=>{
      let current=true;
      const assertSource=()=>{if(!current)throw Object.assign(Error('fixture source changed'),{code:'ESYNC_REQUEST_CONTEXT_CHANGED'});};
      const id=await seed(),r=await run(assertSource).begin();await accept(r,id);const before=await snapshot();
      r.checkpoints={advanceRecovery:async(...args)=>{await checkpoints.advanceRecovery(...args);current=false;}};
      await assert.rejects(r.finish(),e=>e.code==='ESYNC_REQUEST_CONTEXT_CHANGED');await noCheckpoint();assert.equal(await snapshot(),before);
    });
    await reset();
    await test('early recovery proves the same expired default checkpoint before reading graphs and before advancing',async()=>{
      const id=await seed();
      await request().batch("ALTER TABLE dbo.shifts DISABLE CHANGE_TRACKING; ALTER TABLE dbo.shifts ENABLE CHANGE_TRACKING;");
      const ct=(await request().query("SELECT CHANGE_TRACKING_MIN_VALID_VERSION(OBJECT_ID(N'dbo.shifts')) minimum;")).recordset[0];
      assert(BigInt(String(ct.minimum))>1n);
      await request().input('branch',branch).query("INSERT dbo.sync_checkpoints(organization_id,branch_id,entity_type,direction,change_tracking_version) VALUES('other',@branch,'shifts','push',1);");
      await assert.rejects(run(undefined,true).begin(),e=>e.code==='ELOCAL_CT_PENDING');
      await request().query("DELETE dbo.sync_checkpoints WHERE organization_id='other';");
      await checkpoints.save(branch,'shifts','push',{change_tracking_version:1});
      const r=await run(undefined,true).begin();await accept(r,id);
      const before=await snapshot();
      await checkpoints.save(branch,'shifts','push',{change_tracking_version:ct.minimum});
      await assert.rejects(r.finish(),e=>e.code==='ELOCAL_CT_PENDING');assert.equal(await snapshot(),before);
      assert.equal(String((await checkpoints.get(branch,'shifts','push')).change_tracking_version),String(ct.minimum));
    });
    await reset();
    await test('expired V0 retention during download refuses checkpoint completion',async()=>{
      const id=await seed(),r=await run().begin();await accept(r,id);
      await request().batch(`IF OBJECT_ID('dbo.fixture_clock','U') IS NULL BEGIN CREATE TABLE dbo.fixture_clock(id int PRIMARY KEY); ALTER TABLE dbo.fixture_clock ENABLE CHANGE_TRACKING; END;
        INSERT dbo.fixture_clock VALUES(1); DELETE dbo.fixture_clock;
        ALTER TABLE dbo.shifts DISABLE CHANGE_TRACKING; ALTER TABLE dbo.shifts ENABLE CHANGE_TRACKING;`);
      await assert.rejects(r.finish(),e=>e.code==='ELOCAL_PENDING_UNVERIFIED');await noCheckpoint();
    });
    await reset();
    await test('new pending author work after proof prevents final completion',async()=>{
      const id=await seed(),r=await run().begin();await accept(r,id);
      await request().input('id',randomUUID()).input('shift',id).input('branch',branch).query('INSERT dbo.pos_sync_shift_intents(intent_id,branch_id,shift_id) VALUES(@id,@branch,@shift);');
      await assert.rejects(r.finish(),e=>e.code==='ELOCAL_UPLOAD_PENDING');await noCheckpoint();
    });
    await reset();
    await test('body capability lookalike without a private response witness is denied',async()=>{
      const id=await seed(),r=await run().begin(),incoming=JSON.parse(JSON.stringify(await graph(id)));incoming['X-POS-Shift-Graph-Exact']='1';
      await accept(r,id,incoming);await assert.rejects(r.finish(),e=>e.code==='ELOCAL_PENDING_UNVERIFIED');await noCheckpoint();
    });
    await reset();
    await test('usual monotonic checkpoint completion preserves an existing cursor',async()=>{
      const id=await seed();await checkpoints.save(branch,'shifts','push',{change_tracking_version:0,committed_cursor:'fixture-existing-cursor'});
      const r=await run().begin();await accept(r,id);await r.finish();const saved=await checkpoints.get(branch,'shifts','push');
      assert.equal(saved.committed_cursor,'fixture-existing-cursor');assert.equal(String(saved.change_tracking_version),r.baseline);
    });
    await reset();
    await test('trusted post-V0 download remains beyond the completed checkpoint',async()=>{
      const id=await seed(),r=await run().begin();await accept(r,id);
      await request().input('id',randomUUID()).input('branch',branch).query(`;WITH CHANGE_TRACKING_CONTEXT(0x434C4F5544)
        INSERT dbo.shifts(id,store_id,status,state,opened_at,row_version) VALUES(@id,@branch,'OPEN','ACTIVE','2026-01-02T00:00:00+00:00',1);`);
      const current=(await request().query('SELECT CHANGE_TRACKING_CURRENT_VERSION() current_version;')).recordset[0].current_version;
      assert(BigInt(String(current))>BigInt(r.baseline));await r.finish();
      assert.equal(String((await checkpoints.get(branch,'shifts','push')).change_tracking_version),r.baseline);
    });
    await reset();
    await test('SERIALIZABLE graph range locks exclude another SQL writer',async()=>{
      const id=await seed(),r=await run().begin(),tx=new sql.Transaction(pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      try{await r.identities(tx);const blocked=await other.request().input('id',id).query(`SET LOCK_TIMEOUT 250;
        BEGIN TRY UPDATE dbo.shifts SET note=N'concurrent' WHERE id=@id; SELECT 0 error_number; END TRY
        BEGIN CATCH SELECT ERROR_NUMBER() error_number; END CATCH;`);assert.equal(blocked.recordset[0].error_number,1222);}
      finally{await tx.rollback();}
    });
    console.log(`PASS ${passed} isolated SQL Server retained-graph recovery groups`);
  }finally{
    if(other)await other.close();if(pool)await pool.close();
    if(created){assert(owned&&/^Gap53Fixture_[a-f0-9]{32}$/.test(database));await master.request().query(`ALTER DATABASE [${database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${database}];`);}
    if(master)await master.close();
    if(owned){assert(/^CodexGap53_[a-f0-9]{32}$/.test(instance));control('stop',instance,'-k');control('delete',instance);console.log('Cleaned uniquely owned LocalDB fixture');}
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
