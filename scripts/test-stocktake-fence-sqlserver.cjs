// This test creates and removes only its own random LocalDB instance and database.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { createHash, generateKeyPairSync, randomUUID, sign, verify } = require('node:crypto');
const { createLocal } = require('./lib/shift-protocol-integration-fixture.cjs');
const { canonicalInstant } = require('../electron/db/stock-history-contract.cjs');
const { stockCoverageFrontierMessage } = require('../electron/security/stock-event-author-protocol.cjs');
const { createStockCoverageFrontierRuntime } = require('../electron/stock-coverage-frontier-runtime.cjs');
const { scopeHash } = require('../electron/shift-authority.cjs');

assert.deepEqual(process.argv.slice(2), ['--run']);
const read = path => readFileSync(resolve(__dirname, '..', path), 'utf8');
const branch = 'stocktake-alpha', project = 'https://beta.fixture';

(async () => {
 const f = await createLocal(branch, { extraTables: ['products'] });
 try {
  const pool = f.manager.pool, sql = f.manager.sql();
  const findGuid = await pool.request().query('SELECT LOWER(CONVERT(nvarchar(36),database_guid)) id FROM sys.database_recovery_status WHERE database_id=DB_ID();');
  const database = findGuid.recordset[0].id, terminal = randomUUID(), stocktake = randomUUID(), product = randomUUID();
  await pool.request().batch(read('database/sqlserver/prepared/031_stock_history_effective_ledger.sql'));
  await pool.request().batch(read('database/sqlserver/prepared/stock-history-stocktake-fence.sql'));
  const fingerprints = (await pool.request().query(`
   SELECT name,LOWER(CONVERT(char(64),HASHBYTES('SHA2_256',CONVERT(varbinary(max),
    REPLACE(OBJECT_DEFINITION(object_id),NCHAR(13)+NCHAR(10),NCHAR(10)))),2)) sha256
   FROM sys.objects WHERE name IN('TR_stock_history_stocktake_products','pos_stock_history_arm_stocktake',
    'pos_stock_history_release_stocktake') ORDER BY name;`)).recordset;
  assert.equal(fingerprints.length,3);
  if (process.env.STOCKTAKE_PRINT_FIXTURE_FINGERPRINTS === '1') console.log(JSON.stringify(fingerprints));
  const writeStock = amount => pool.request().input('id',product).input('amount',amount).query(
   'UPDATE dbo.products SET stock_quantity=@amount WHERE id=CONVERT(uniqueidentifier,@id);');
  const inTx = async work => {
   const tx = new sql.Transaction(pool);
   await tx.begin();
   try { const result = await work(new sql.Request(tx)); await tx.commit(); return result; }
   catch (error) { await tx.rollback().catch(() => {}); throw error; }
  };
  const now = async seconds => (await pool.request().input('seconds',seconds).query(
   'SELECT CONVERT(varchar(27),DATEADD(second,@seconds,SYSUTCDATETIME()),126) expires;')).recordset[0].expires;
  const arm = (id, deadline, databaseId=database) => inTx(request => request
   .input('id',id).input('project',project).input('branch',branch).input('terminal',terminal)
   .input('database',databaseId).input('expires',deadline).query(
    'DECLARE @d datetime2(7)=CONVERT(datetime2(7),@expires,126); EXEC dbo.pos_stock_history_arm_stocktake @id,@project,@branch,@terminal,@database,@d;'));
  const release = (id, generation) => inTx(request => request.input('id',id).input('generation',generation).input('database',database)
   .query('EXEC dbo.pos_stock_history_release_stocktake @id,@generation,@database;'));
  const state = async id => (await pool.request().input('id',id).query(`
   SELECT LOWER(CONVERT(varchar(36),generation)) generation,released_at FROM dbo.stock_history_stocktake_fences
   WHERE stocktake_id=CONVERT(uniqueidentifier,@id);`)).recordset[0];

  await f.insert('products', { id: product, stock_quantity: 1, stock_by_store: { [branch]: 1 } });
  const deadline = await now(30);
  await assert.rejects(arm(stocktake,deadline,randomUUID()), /STOCK_HISTORY_STOCKTAKE_SCOPE_DENIED/);
  await arm(stocktake,deadline);
  const first = await state(stocktake);
  await arm(stocktake,deadline);
  assert.equal((await state(stocktake)).generation,first.generation);
  await assert.rejects(writeStock(2), /STOCK_HISTORY_STOCKTAKE_PAUSED/);
  await assert.rejects(arm(randomUUID(),deadline), /STOCK_HISTORY_STOCKTAKE_ALREADY_ACTIVE/);
  const paused = (await pool.request().input('id',product).query('SELECT stock_quantity FROM dbo.products WHERE id=@id;')).recordset[0];
  assert.equal(paused.stock_quantity, 1);
  console.log('PASS bound local fence blocks stock from a separate SQL session and exact arm retry keeps the same generation');

  await release(stocktake,first.generation);
  await assert.rejects(arm(stocktake,deadline), /STOCK_HISTORY_STOCKTAKE_SCOPE_DENIED/);
  await writeStock(2);
  assert((await state(stocktake)).released_at);
  console.log('PASS release restores trading and cannot resurrect the old fence');

  const expired = randomUUID(), expiry = await now(1);
  await arm(expired,expiry);
  await pool.request().batch("WAITFOR DELAY '00:00:01.200';");
  await writeStock(3);
  assert((await state(expired)).released_at);
  console.log('PASS a committed stock write after expiry permanently retires the old fence');

  const concurrent = randomUUID(), next = await now(30);
  const writer = new sql.Transaction(pool);
  let armWhileWriting;
  await writer.begin();
  try {
   await new sql.Request(writer).input('id',product).query('UPDATE dbo.products SET stock_quantity=4 WHERE id=@id;');
   armWhileWriting = arm(concurrent,next);
   await assert.rejects(armWhileWriting, /STOCK_HISTORY_STOCKTAKE_RETRY/);
  } finally { await writer.commit(); }
  await arm(concurrent,next);
  await assert.rejects(writeStock(5), /STOCK_HISTORY_STOCKTAKE_PAUSED/);
  await release(concurrent,(await state(concurrent)).generation);
  console.log('PASS arming waits for an earlier stock transaction and can retry after that transaction commits');

  const crypto = generateKeyPairSync('ed25519'), keyId = randomUUID(), authorId = randomUUID(), realStocktake = randomUUID();
  const publicKey = crypto.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url');
  const binding = { projectOrigin: project, terminalId: terminal, authorId };
  await pool.request().input('scope',scopeHash(binding)).input('project',project).input('terminal',terminal)
   .input('author',authorId).input('key',keyId).input('public',publicKey).query(`
   INSERT dbo.pos_sync_shift_author_keys(scope_hash,project_origin,terminal_id,author_id,key_id,public_key)
   VALUES(@scope,@project,@terminal,@author,@key,@public);`);
  const lease = (await pool.request().query(`DECLARE @now datetime2(7)=DATEADD(second,-1,SYSUTCDATETIME());
   SELECT CONVERT(varchar(27),@now,126) issued,CONVERT(varchar(27),DATEADD(minute,5,@now),126) expires;`)).recordset[0];
  const leaseIssuedAt=canonicalInstant(lease.issued+'Z'), leaseExpiresAt=canonicalInstant(lease.expires+'Z');
  const wall=async()=>canonicalInstant(await now(0)+'Z');
  const hash=value=>createHash('sha256').update(value,'utf8').digest('hex');
  let accepted=0,drained=0;
  const runtime=createStockCoverageFrontierRuntime({
   manager:f.manager,terminal:()=>({tokenId:terminal,locationId:branch,deviceType:'pc',deviceUse:'operations'}),
   project:()=>project,branch:()=>branch,context:()=>'owned-stocktake-fixture',expectedDatabaseGuid:database,
   session:{hasPosAuthority:()=>true,identity:()=>({source:'pos',level:'admin',authorId,canonicalSubject:'owned-fixture-admin',branchId:branch}),epoch:()=>1},
   keys:{prepare:()=>({enrolled:true,keyId,publicKey}),signStockCoverageFrontier:(_binding,input)=>{
    const {challengeId}=JSON.parse(input.frontierJson);
    const fields={version:1,algorithm:'Ed25519',keyId,...binding,subject:input.subject,branchId:branch,challengeId,frontierHash:hash(input.frontierJson)};
    return {...fields,signature:sign(null,Buffer.from(stockCoverageFrontierMessage(fields)),crypto.privateKey).toString('base64url')};
   }},
   stocktakeBackend:{
    async loadLease(scope,purpose){
     assert.equal(scope.databaseId,database);assert.equal(scope.terminalId,terminal);assert.equal(scope.stocktakeId,realStocktake);
     return {stocktakeId:scope.stocktakeId,projectOrigin:project,branchId:branch,terminalId:terminal,databaseId:database,
      leaseIssuedAt,leaseExpiresAt,state:purpose==='confirm'?'armed':'draining'};
    },
    async drain(){
     ++drained;await assert.rejects(writeStock(9),/STOCK_HISTORY_STOCKTAKE_PAUSED/);
     return {ok:true,final:true,allUploaded:true,pending:0,failed:0};
    },
    async loadRelease(scope){
     return {...scope,state:'released',releasedAt:await wall()};
    },
   },
   cloud:{
    async requestStockFrontierChallenge({challengeId}){
     return {ok:true,version:1,branchId:branch,terminalId:terminal,
      challenge:{challengeId,nonce:'A'.repeat(43),cohortHash:'b'.repeat(64),issuedAt:await wall(),expiresAt:leaseExpiresAt}};
    },
    async acceptStockFrontier({frontierJson,proofJson}){
     const frontier=JSON.parse(frontierJson),{signature,...proof}=JSON.parse(proofJson);
     assert.equal(verify(null,Buffer.from(stockCoverageFrontierMessage(proof)),crypto.publicKey,Buffer.from(signature,'base64url')),true);
     assert.deepEqual(frontier.pending,{business:'0',metadata:'0',unsigned:'0',unknown:'0'});
     assert.equal(frontier.databaseId,database);
     ++accepted;
     return {ok:true,version:1,branchId:branch,terminalId:terminal,receipt:{challengeId:frontier.challengeId,frontierHash:hash(frontierJson),
      state:'accepted',observationGrade:'author_claimed',reasons:[],acceptedAt:await wall()}};
    },
   },
  });
  const request={assertLease:()=>true,stocktakeId:realStocktake};
  const armed=await runtime.stocktake.arm(request);
  assert.equal(await runtime.run(request).then(result=>result.reason),'STOCKTAKE_FENCE_ACTIVE');
  const proof=await runtime.stocktake.prove({...request,phase:'arm'});
  assert.deepEqual(proof,{terminalId:terminal,challengeId:proof.challengeId,databaseId:database,fenceGeneration:armed.fenceGeneration,
   localFencedAt:armed.localFencedAt,localExpiresAt:armed.localExpiresAt});
  await pool.request().input('branch',branch).query(`INSERT dbo.sync_change_journal
   (entity_type,entity_id,operation,branch_id,entity_version) VALUES(N'sales',N'{}',N'insert',@branch,1);`);
  await assert.rejects(runtime.stocktake.prove({...request,phase:'confirm'}),{code:'ESTOCK_STOCKTAKE_PENDING'});
  assert.equal(accepted,1);assert.equal(drained,2);
  await runtime.stocktake.release({...request,fenceGeneration:armed.fenceGeneration});
  await writeStock(6);
  console.log('PASS Main factory signs the actual clean serializable SQL observation, retains pending work and releases via scoped verified receipt');
 } finally { await f.close(); }
})().catch(error => { console.error(error.message); process.exitCode=1; });
