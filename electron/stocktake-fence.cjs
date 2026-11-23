'use strict';

const {createHash}=require('node:crypto');
const {canonicalInstant,fail,identifier,instant}=require('./db/stock-history-contract.cjs');
const {readStockHistoryFrontierSnapshot}=require('./db/stock-history-frontier-snapshot.cjs');

const hash=value=>createHash('sha256').update(value,'utf8').digest('hex');
const cleanGapHash=hash('[]');
const emptyCounts=['business','metadata','unsigned','unknown'];
const localDefinitionSql=`
 IF NOT EXISTS(SELECT 1 FROM sys.database_recovery_status WHERE database_id=DB_ID() AND database_guid=CONVERT(uniqueidentifier,@database))
  THROW 51031,'STOCK_HISTORY_STOCKTAKE_SCOPE_DENIED',1;
 IF OBJECT_ID(N'dbo.stock_history_stocktake_fences',N'U') IS NULL OR NOT EXISTS(
  SELECT 1 FROM sys.triggers WHERE object_id=OBJECT_ID(N'dbo.TR_stock_history_stocktake_products')
   AND parent_id=OBJECT_ID(N'dbo.products') AND is_disabled=0 AND is_not_for_replication=0)
  THROW 51031,'STOCK_HISTORY_STOCKTAKE_SCHEMA_REQUIRED',1;
 IF EXISTS(SELECT 1 FROM (VALUES
  (N'dbo.pos_stock_history_arm_stocktake',N'ac32f5b8376b20e3a74cd18999566e632ca99e64427b4da9892005fb8938c71e'),
  (N'dbo.pos_stock_history_release_stocktake',N'75f52c6e802777d164ce4595784495ca44daef5aa9322d389fcadfeb9bbb2aad'),
  (N'dbo.TR_stock_history_stocktake_products',N'bf66a89309c2fe965100f0034d4e4124d619c99957b490a21293e8cc0845b778')
 ) pins(name,digest) WHERE COALESCE(LOWER(CONVERT(char(64),HASHBYTES('SHA2_256',
  CONVERT(varbinary(max),REPLACE(OBJECT_DEFINITION(OBJECT_ID(name)),NCHAR(13)+NCHAR(10),NCHAR(10)))),2)),'')<>digest)
  THROW 51031,'STOCK_HISTORY_STOCKTAKE_SCHEMA_REQUIRED',1;`;
const readFenceSql=`/*stocktake:fence*/
 DECLARE @latch int;
 EXEC @latch=sys.sp_getapplock @Resource=N'retail:stock-history:stocktake',@LockMode=N'Shared',@LockOwner=N'Transaction',@LockTimeout=2000;
 IF @latch<0 THROW 51031,'STOCK_HISTORY_STOCKTAKE_RETRY',1;
 ${localDefinitionSql}
 SELECT LOWER(CONVERT(nvarchar(36),generation)) AS generation,
  CONVERT(nvarchar(40),fenced_at,126)+N'Z' AS fenced_at,CONVERT(nvarchar(40),expires_at,126)+N'Z' AS expires_at,
  CONVERT(nvarchar(40),SYSUTCDATETIME(),126)+N'Z' AS observed_at,
  CONVERT(bit,CASE WHEN released_at IS NULL THEN 0 ELSE 1 END) AS released
 FROM dbo.stock_history_stocktake_fences WITH(HOLDLOCK,NOWAIT)
 WHERE stocktake_id=CONVERT(uniqueidentifier,@stocktake) AND terminal_id=CONVERT(uniqueidentifier,@terminal)
  AND database_id=CONVERT(uniqueidentifier,@database) AND project_origin=@project AND branch_id=@branch
  AND DATALENGTH(project_origin)=DATALENGTH(@project) AND DATALENGTH(branch_id)=DATALENGTH(@branch);`;

function stocktakeInstant(value){
 if(typeof value!=='string'||canonicalInstant(value)!==value)fail('ESTOCK_STOCKTAKE_SCOPE');
 return value;
}

function checkedLease(capture,stocktakeId,purpose,value){
 const id=identifier(stocktakeId,true);
 const allowed=purpose==='arm'?['draining','armed']:purpose==='confirm'?['armed']:['draining','armed','released','expired'];
 if(value?.stocktakeId!==id||value.projectOrigin!==capture.binding.projectOrigin||value.branchId!==capture.branchId||
  value.terminalId!==capture.binding.terminalId||value.databaseId!==capture.databaseId||!allowed.includes(value.state))
  fail('ESTOCK_STOCKTAKE_SCOPE');
 const issuedAt=stocktakeInstant(value.leaseIssuedAt),expiresAt=stocktakeInstant(value.leaseExpiresAt);
 if(instant(expiresAt)-instant(issuedAt)!==3000000000n)fail('ESTOCK_STOCKTAKE_SCOPE');
 return Object.freeze({id,issuedAt,expiresAt});
}

function stocktakeGapHash(capture,lease,phase,claim){
 if(phase!=='arm'&&phase!=='confirm')fail('ESTOCK_STOCKTAKE_SCOPE');
 return hash(['stock401-pause-v1',phase,capture.binding.projectOrigin,capture.branchId,lease.id,
  claim.terminalId,claim.challengeId,claim.databaseId,claim.fenceGeneration,claim.localFencedAt,claim.localExpiresAt].join('\x1f'));
}

function createStocktakeFence({manager,drain,readSnapshot=readStockHistoryFrontierSnapshot}){
 async function inTransaction(capture,work){
  capture.assertCurrent();
  const sql=manager.sql(),transaction=new sql.Transaction(capture.pool);
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try{
   const value=await work(transaction,sql);
   capture.assertCurrent();
   await transaction.commit();
   capture.assertCurrent();
   return value;
  }catch(error){
   await transaction.rollback().catch(()=>undefined);
   throw error;
  }
 }

 const scopedRequest=(sql,transaction,capture,lease)=>new sql.Request(transaction,{requestTimeout:3000})
  .input('database',sql.NVarChar(36),capture.databaseId)
  .input('terminal',sql.NVarChar(36),capture.binding.terminalId)
  .input('project',sql.NVarChar(255),capture.binding.projectOrigin)
  .input('branch',sql.NVarChar(128),capture.branchId)
  .input('stocktake',sql.NVarChar(36),lease.id);

 async function readFence(capture,lease,transaction,sql){
  capture.assertCurrent();
  const rows=(await scopedRequest(sql,transaction,capture,lease).query(readFenceSql)).recordset??[];
  capture.assertCurrent();
  if(rows.length!==1)fail('ESTOCK_STOCKTAKE_FENCE_UNAVAILABLE');
  const row=rows[0],generation=identifier(row.generation,true);
  const fencedAt=canonicalInstant(row.fenced_at),expiresAt=canonicalInstant(row.expires_at),observedAt=canonicalInstant(row.observed_at);
  if(typeof row.released!=='boolean'||instant(fencedAt)<instant(lease.issuedAt)||expiresAt!==lease.expiresAt||
   instant(observedAt)<instant(fencedAt))fail('ESTOCK_STOCKTAKE_SCOPE');
  return {generation,fencedAt,expiresAt,observedAt,released:row.released};
 }

 function requireActive(fence){
  if(fence.released||instant(fence.observedAt)>=instant(fence.expiresAt))fail('ESTOCK_STOCKTAKE_FENCE_CLOSED');
  return fence;
 }

 const active=(capture,lease)=>inTransaction(capture,async(tx,sql)=>requireActive(await readFence(capture,lease,tx,sql)));

 async function suppressNormalObservation(capture){
  return inTransaction(capture,async(tx,sql)=>{
   const request=()=>new sql.Request(tx,{requestTimeout:3000});
   const optional=(await request().query(`/*stocktake:optional*/
    SELECT CONVERT(bit,CASE WHEN OBJECT_ID(N'dbo.stock_history_stocktake_fences',N'U') IS NULL THEN 0 ELSE 1 END) installed;`
   )).recordset?.[0];
   if(optional?.installed===false)return false;
   if(optional?.installed!==true)fail('ESTOCK_STOCKTAKE_SCOPE');
   const scoped=scopedRequest(sql,tx,capture,{id:null});
   const current=(await scoped.query(`/*stocktake:normal-observation*/
    ${localDefinitionSql}
    SELECT CONVERT(bit,CASE WHEN EXISTS(SELECT 1 FROM dbo.stock_history_stocktake_fences WITH(HOLDLOCK,NOWAIT)
     WHERE project_origin=@project AND branch_id=@branch AND terminal_id=CONVERT(uniqueidentifier,@terminal)
      AND database_id=CONVERT(uniqueidentifier,@database)
      AND DATALENGTH(project_origin)=DATALENGTH(@project) AND DATALENGTH(branch_id)=DATALENGTH(@branch)
      AND released_at IS NULL AND expires_at>SYSUTCDATETIME()) THEN 1 ELSE 0 END) paused;`
   )).recordset?.[0];
   if(typeof current?.paused!=='boolean')fail('ESTOCK_STOCKTAKE_SCOPE');
   return current.paused;
  });
 }

 async function arm(capture,lease){
  return inTransaction(capture,async(tx,sql)=>{
   await scopedRequest(sql,tx,capture,lease).input('expires',sql.NVarChar(28),lease.expiresAt).query(`/*stocktake:arm*/
    ${localDefinitionSql}
    DECLARE @d uniqueidentifier=CONVERT(uniqueidentifier,@database),@t uniqueidentifier=CONVERT(uniqueidentifier,@terminal),
     @s uniqueidentifier=CONVERT(uniqueidentifier,@stocktake),@e datetime2(7)=CONVERT(datetime2(7),LEFT(@expires,27),126);
    EXEC dbo.pos_stock_history_arm_stocktake @s,@project,@branch,@t,@d,@e;`);
   const fence=requireActive(await readFence(capture,lease,tx,sql));
   return Object.freeze({stocktakeId:lease.id,fenceGeneration:fence.generation,localFencedAt:fence.fencedAt,localExpiresAt:fence.expiresAt});
  });
 }

 async function drainBeforeProof(capture,lease){
  const fence=await active(capture,lease);
  const result=await drain({branchId:capture.branchId,batchSize:500});
  capture.assertCurrent();
  if(result?.ok!==true||result.final!==true||result.allUploaded!==true||result.pending!==0||result.failed!==0||
   result.reportHistoryPending||result.historyUploadHeld||result.cashUploadHeld||result.refundUploadHeld||result.deferredTables?.length)
   fail('ESTOCK_STOCKTAKE_PENDING');
  return fence.generation;
 }

 async function observe(capture,lease,generation,sign){
  function verifyClean(snapshot,fence){
   if(snapshot?.available!==true||snapshot.databaseId!==capture.databaseId||snapshot.branchId!==capture.branchId||
    snapshot.terminalId!==capture.binding.terminalId||snapshot.gapHash!==cleanGapHash||
    !Array.isArray(snapshot.blockers)||snapshot.blockers.length||!snapshot.pending||
    Object.keys(snapshot.pending).length!==emptyCounts.length||emptyCounts.some(key=>snapshot.pending[key]!=='0')||
    instant(snapshot.observedAt)<instant(fence.fencedAt)||instant(snapshot.observedAt)>=instant(fence.expiresAt))
    fail('ESTOCK_STOCKTAKE_PENDING');
   return snapshot;
  }
  function sameFence(before,after){
   return before.generation===after.generation&&before.fencedAt===after.fencedAt&&before.expiresAt===after.expiresAt&&
    instant(after.observedAt)>=instant(before.observedAt);
  }
  function snapshot(capture,transaction){
   return readSnapshot({manager,transaction,firstStocktake:true,branchId:capture.branchId,terminalId:capture.binding.terminalId,
    assertCurrent:capture.assertCurrent,assertLease:capture.assertLease});
  }
  return inTransaction(capture,async(tx,sql)=>{
   const before=requireActive(await readFence(capture,lease,tx,sql));
   if(before.generation!==generation)fail('ESTOCK_STOCKTAKE_FENCE_CHANGED');
   const actual=verifyClean(await snapshot(capture,tx),before);
   const signed=sign(actual,before);
   if(!signed||typeof signed.then==='function')fail('ESTOCK_STOCKTAKE_SCOPE');
   capture.assertCurrent();
   const current=verifyClean(await snapshot(capture,tx),before);
   const after=requireActive(await readFence(capture,lease,tx,sql));
   if(!sameFence(before,after)||instant(current.observedAt)<instant(actual.observedAt)||
    ['databaseKey','sourceSequence','sourceRoot','sourceGeneration','gapHash'].some(key=>current[key]!==actual[key]))
    fail('ESTOCK_STOCKTAKE_FENCE_CHANGED');
   return signed;
  });
 }

 async function release(capture,lease,generation,cloudRelease){
  const canRelease=cloudRelease?.stocktakeId===lease.id&&cloudRelease.projectOrigin===capture.binding.projectOrigin&&
   cloudRelease.branchId===capture.branchId&&cloudRelease.terminalId===capture.binding.terminalId&&cloudRelease.databaseId===capture.databaseId&&
   cloudRelease.state==='released'&&
   instant(stocktakeInstant(cloudRelease.releasedAt))>=instant(lease.issuedAt);
  return inTransaction(capture,async(tx,sql)=>{
   const fence=await readFence(capture,lease,tx,sql);
   if(fence.generation!==identifier(generation,true))fail('ESTOCK_STOCKTAKE_FENCE_CHANGED');
   if(fence.released)return {released:true};
   if(!canRelease&&instant(fence.observedAt)<instant(fence.expiresAt))fail('ESTOCK_STOCKTAKE_RELEASE_UNCONFIRMED');
   await scopedRequest(sql,tx,capture,lease).input('generation',sql.NVarChar(36),fence.generation).query(`/*stocktake:release*/
    DECLARE @d uniqueidentifier=CONVERT(uniqueidentifier,@database),@g uniqueidentifier=CONVERT(uniqueidentifier,@generation),
      @s uniqueidentifier=CONVERT(uniqueidentifier,@stocktake);
    EXEC dbo.pos_stock_history_release_stocktake @s,@g,@d;`);
   if(!(await readFence(capture,lease,tx,sql)).released)fail('ESTOCK_STOCKTAKE_RELEASE_UNCONFIRMED');
   return {released:true};
  });
 }

 const enrollmentSnapshot=capture=>inTransaction(capture,transaction=>readSnapshot({manager,
  transaction,firstStocktake:true,branchId:capture.branchId,terminalId:capture.binding.terminalId,
  assertCurrent:capture.assertCurrent,assertLease:capture.assertLease}));
 return Object.freeze({arm,drainBeforeProof,observe,release,suppressNormalObservation,enrollmentSnapshot});
}

module.exports={checkedLease,createStocktakeFence,stocktakeGapHash};
