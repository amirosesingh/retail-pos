// NOT an installer. Owned disposable LocalDB fixture only; no POS_Local/profile/network.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {randomUUID}=require('node:crypto'),{spawnSync}=require('node:child_process');
const sql=require('mssql/msnodesqlv8');
async function main(){
 assert.deepEqual(process.argv.slice(2),['--run']);
 const source=fs.readFileSync(path.join(__dirname,'preparation/025_shift_financial_bases.sql'),'utf8');
 assert(source.includes('NOT FINAL / DO NOT EXECUTE'));
 const suffix=randomUUID().replaceAll('-',''),instance='CodexBasis_'+suffix,database='BasisFixture_'+suffix;
 const control=(...args)=>{const result=spawnSync('C:/Program Files/Microsoft SQL Server/170/Tools/Binn/SqlLocalDB.exe',args,{windowsHide:true,timeout:30000});const decode=out=>(out??Buffer.alloc(0)).toString(out?.includes(0)?'utf16le':'utf8').replace(/^\uFEFF/,'');const text=decode(result.stdout),errors=decode(result.stderr);assert(!result.error&&result.status===0&&!/failed|unexpected error/i.test(text+errors),text+errors);return text;};
 let owned=false,created=false,master,pool,server,passed=0;
 const connect=name=>new sql.ConnectionPool({connectionString:`Driver={ODBC Driver 18 for SQL Server};Server=${server};Database=${name};Trusted_Connection=Yes;Encrypt=No;TrustServerCertificate=Yes;`,pool:{min:0,max:1},requestTimeout:15000}).connect();
 try{
  control('create',instance,'-s');owned=true;server=control('info',instance).match(/np:\\\\\.\\pipe\\LOCALDB#[A-Fa-f0-9]+\\tsql\\query/)?.[0];assert(server);
  master=await connect('master');await master.request().batch(`CREATE DATABASE [${database}]`);created=true;pool=await connect(database);
  await pool.request().batch("CREATE TABLE dbo.business_sentinel(id int PRIMARY KEY,payload nvarchar(max));INSERT dbo.business_sentinel VALUES(1,N'unchanged sales stock config queue');");

  const run=()=>pool.request().batch(source);
  const test=async(name,fn)=>{await fn();passed++;console.log('PASS '+name);};
  const bad=fn=>assert.rejects(fn);
  const row=`'11111111-1111-4111-8111-111111111111',N'A','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333',1,N'{}','${'a'.repeat(64)}','2026-11-04T00:00:00+00:00'`;
  await test('caller transaction remains intact and metadata absent',async()=>{
   const tx=new sql.Transaction(pool);await tx.begin();
   try{await new sql.Request(tx).query("SET XACT_ABORT ON;INSERT dbo.business_sentinel VALUES(2,N'caller transaction');");
    await bad(()=>new sql.Request(tx).batch(source));
    const result=(await new sql.Request(tx).query("SELECT XACT_STATE() s,@@TRANCOUNT n,OBJECT_ID(N'dbo.pos_sync_shift_financial_bases') o,(SELECT count(*) FROM dbo.business_sentinel WHERE id=2) kept;")).recordset[0];
    assert.deepEqual(result,{s:1,n:1,o:null,kept:1});
   }finally{await tx.rollback();}
  });
  await test('additive creation and exact repeat preserve domain sentinel and metadata',async()=>{await run();await pool.request().query(`INSERT dbo.pos_sync_shift_financial_bases VALUES(${row});`);await run();assert.equal((await pool.request().query('SELECT count(*) n FROM dbo.pos_sync_shift_financial_bases')).recordset[0].n,1);assert.equal((await pool.request().query('SELECT payload FROM dbo.business_sentinel')).recordset[0].payload,'unchanged sales stock config queue');});
  await test('immutable update/delete and duplicate intent fail',async()=>{await bad(()=>pool.request().query("UPDATE dbo.pos_sync_shift_financial_bases SET branch_id=N'B'"));await bad(()=>pool.request().query('DELETE dbo.pos_sync_shift_financial_bases'));await bad(()=>pool.request().query(`INSERT dbo.pos_sync_shift_financial_bases VALUES(${row})`));});
  await test('invalid JSON/hash/version/null identity fail',async()=>{for(const changed of [row.replace("N'{}'","N'bad'"),row.replace('a'.repeat(64),'g'.repeat(64)),row.replace('a'.repeat(64),'a'.repeat(63)),row.replace(",1,N'{}'",",2,N'{}'"),row.replace("'11111111-1111-4111-8111-111111111111'",'NULL')])await bad(()=>pool.request().query(`INSERT dbo.pos_sync_shift_financial_bases VALUES(${changed.replace('11111111-1111-4111-8111-111111111111','44444444-4444-4444-8444-444444444444')})`));});
  await test('unknown extra column aborts without mutation',async()=>{await pool.request().query('ALTER TABLE dbo.pos_sync_shift_financial_bases ADD unexpected int NULL');await bad(run);assert.equal((await pool.request().query('SELECT count(*) n FROM dbo.pos_sync_shift_financial_bases')).recordset[0].n,1);await pool.request().query('ALTER TABLE dbo.pos_sync_shift_financial_bases DROP COLUMN unexpected');await run();});
  await test('IGNORE_DUP_KEY primary index is rejected without mutation',async()=>{
   await pool.request().batch('ALTER TABLE dbo.pos_sync_shift_financial_bases DROP CONSTRAINT PK_pos_sync_shift_financial_bases;ALTER TABLE dbo.pos_sync_shift_financial_bases ADD CONSTRAINT PK_pos_sync_shift_financial_bases PRIMARY KEY CLUSTERED(intent_id) WITH (IGNORE_DUP_KEY=ON);');
   await bad(run);assert.equal((await pool.request().query('SELECT count(*) n FROM dbo.pos_sync_shift_financial_bases')).recordset[0].n,1);
   await pool.request().batch('ALTER TABLE dbo.pos_sync_shift_financial_bases DROP CONSTRAINT PK_pos_sync_shift_financial_bases;ALTER TABLE dbo.pos_sync_shift_financial_bases ADD CONSTRAINT PK_pos_sync_shift_financial_bases PRIMARY KEY CLUSTERED(intent_id) WITH (IGNORE_DUP_KEY=OFF);');await run();
  });
  await test('disabled check and altered trigger abort',async()=>{await pool.request().query('ALTER TABLE dbo.pos_sync_shift_financial_bases NOCHECK CONSTRAINT CK_pos_sync_shift_financial_bases_json');await bad(run);await pool.request().query('ALTER TABLE dbo.pos_sync_shift_financial_bases WITH CHECK CHECK CONSTRAINT CK_pos_sync_shift_financial_bases_json');await pool.request().batch('ALTER TRIGGER dbo.pos_sync_shift_financial_bases_immutable ON dbo.pos_sync_shift_financial_bases AFTER UPDATE,DELETE AS BEGIN SET NOCOUNT ON; END');await bad(run);await pool.request().batch('DROP TRIGGER dbo.pos_sync_shift_financial_bases_immutable');await bad(run);});
  assert.equal((await pool.request().query('SELECT payload FROM dbo.business_sentinel')).recordset[0].payload,'unchanged sales stock config queue');
  console.log(passed+' isolated local financial-bases upgrade groups passed. Preparation only; no operator migration applied.');
 }finally{await pool?.close();if(created){assert(owned&&/^BasisFixture_[a-f0-9]{32}$/.test(database));await master.request().batch(`ALTER DATABASE [${database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;DROP DATABASE [${database}]`);}await master?.close();if(owned){control('stop',instance,'-k');control('delete',instance);console.log('Cleaned owned basis fixture '+instance+' / '+database);}}
}
main().catch(error=>{console.error(error.message);for(const preceding of error.precedingErrors??[])console.error(preceding.message);process.exitCode=1;});
