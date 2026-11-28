'use strict';
// Called only inside the uniquely-owned disposable stock fixture.
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {StockHistoryStore}=require('../electron/db/stock-history.cjs');
module.exports=async({sql,connect,database,pool,pass})=>{
 const single=await connect(database,1),manager={pool:single,sql:()=>sql};
 const session=async()=>({...((await single.request().query('SELECT @@SPID spid,@@TRANCOUNT tx,@@OPTIONS options,@@LOCK_TIMEOUT lock_timeout;')).recordset[0]),
  ...((await single.request().query('SELECT transaction_isolation_level,deadlock_priority FROM sys.dm_exec_sessions WHERE session_id=@@SPID;')).recordset[0])});
 let authority=0;
 const store=new StockHistoryStore(manager,{authorizeRead:async()=>{
  authority++;assert.equal((await single.request().query('SELECT @@TRANCOUNT n;')).recordset[0].n,0);
  return{contextKey:'fixture-current',branchId:'a',canViewInventory:true};
 }}),read=()=>store.readPage({cutoff:'2026-11-05T12:00:00.0000001Z',timeZone:'UTC'});
 try{
  await single.request().query('ALTER DATABASE CURRENT SET ALLOW_SNAPSHOT_ISOLATION ON;');
  for(const isolation of['READ UNCOMMITTED','READ COMMITTED','REPEATABLE READ','SERIALIZABLE','SNAPSHOT']){
   await single.request().query(`SET TRANSACTION ISOLATION LEVEL ${isolation};`);
   const before=await session(),calls=authority;await read();assert.deepEqual(await session(),before);assert.equal(authority,calls+2);
   pass('report reader preserves '+isolation+' and releases its only connection before fresh SQL authority');
  }
  // A separate authority-free instance reaches the caller transaction guard.
  const direct=new StockHistoryStore(manager,{authorizeRead:async()=>({contextKey:'fixture-direct',branchId:'a',canViewInventory:true})});
  await single.request().query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED;BEGIN TRANSACTION;');
  await assert.rejects(direct.readPage({cutoff:'2026-11-05T12:00:00Z',timeZone:'UTC'}),{code:'ESTOCK_HISTORY_CALLER_TRANSACTION'});
  assert.equal((await single.request().query('SELECT @@TRANCOUNT n;')).recordset[0].n,1);await single.request().query('ROLLBACK;');
  pass('report reader refuses an inherited transaction without committing or rolling it back');
  await single.request().query('SET IMPLICIT_TRANSACTIONS ON;');
  await assert.rejects(direct.readPage({cutoff:'2026-11-05T12:00:00Z',timeZone:'UTC'}),{code:'ESTOCK_HISTORY_CALLER_TRANSACTION'});
  assert.equal((await single.request().query('SELECT @@TRANCOUNT n;')).recordset[0].n,0);await single.request().query('SET IMPLICIT_TRANSACTIONS OFF;');
  pass('report reader refuses implicit transactions without leaving pooled settings changed');
  const product=randomUUID(),writer=new StockHistoryStore({pool,sql:()=>sql}),tx=new sql.Transaction(pool);
  await pool.request().input('id',product).query("INSERT dbo.products(id,name,stock_by_store) VALUES(@id,N'Contested report fixture',N'{\"a\":3}');");
  await tx.begin();
  try{
   const operations=[{kind:'update',table:'products',match:{id:product},values:{stock_by_store:{a:2}}}];
   const token=await writer.begin(tx,operations,{operationId:randomUUID(),branchId:'a',terminalId:'t',kind:'stock'});
   await new sql.Request(tx).input('id',product).query("UPDATE dbo.products SET stock_by_store=N'{\"a\":2}' WHERE id=@id;");
   await writer.finish(tx,token);
   const before=await session(),started=Date.now();await assert.rejects(read(),error=>error.number===1222||error.originalError?.info?.number===1222);
   assert(Date.now()-started<3000);assert.deepEqual(await session(),before);await tx.commit();
   assert.equal(JSON.parse((await pool.request().input('id',product).query('SELECT stock_by_store FROM dbo.products WHERE id=@id;')).recordset[0].stock_by_store).a,2);
   await read();pass('report NOWAIT yields to actual uncommitted StockHistoryStore stock save and later retries without data loss');
  }catch(error){await tx.rollback().catch(()=>{});throw error;}
 }finally{
  await single.request().query('IF @@TRANCOUNT>0 ROLLBACK;SET IMPLICIT_TRANSACTIONS OFF;').catch(()=>{});
  await single.close();
 }
};
