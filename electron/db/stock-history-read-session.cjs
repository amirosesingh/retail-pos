'use strict';
// Private report reader only. No business transaction or caller session SETs.
const {performance}=require('node:perf_hooks');
const READERS=new WeakMap(),REQUEST_MS=1000,TOTAL_MS=5000;
const failure=code=>Object.assign(new Error('Stock history is busy. Try again shortly.'),{code});
function stockHistoryReadRequest(parent){const make=READERS.get(parent);return make?make():null;}
async function withStockHistoryReadSession(manager,assertCurrent,work){
 const pool=manager.pool,sql=manager.sql(),started=performance.now();
 let connection,settings,released=false,owned=false;
 const guard=()=>{
  if(manager.pool!==pool)throw failure('ESTOCK_HISTORY_CONTEXT_CHANGED');
  const value=assertCurrent();if(value===false||value&&typeof value.then==='function')throw failure('ESTOCK_HISTORY_CONTEXT_CHANGED');
  if(performance.now()-started>TOTAL_MS)throw failure('ESTOCK_HISTORY_TIMEOUT');
 };
 const parent={config:pool.config,connected:pool.connected??true,
  acquire(_request,callback){queueMicrotask(()=>callback(null,connection,settings));},release(){}};
 const release=()=>{if(connection&&!released){released=true;pool.release(connection);}};
 const raw=text=>new sql.Request(parent,{requestTimeout:REQUEST_MS}).query(text);
 const make=()=>{
  const request=new sql.Request(parent,{requestTimeout:REQUEST_MS}),query=request.query.bind(request);
  request.query=async text=>{guard();const result=await query(text);guard();return result;};return request;
 };
 try{
  guard();let abandoned=false,timer;
  try{await Promise.race([
   new Promise((resolve,reject)=>pool.acquire(parent,(error,value,config)=>{
    if(error)return reject(error);connection=value;settings=config;
    if(abandoned){release();return resolve();}resolve();
   })),
   new Promise((_,reject)=>{timer=setTimeout(()=>{abandoned=true;reject(failure('ESTOCK_HISTORY_BUSY'));},REQUEST_MS);}),
  ]);}finally{clearTimeout(timer);}
  guard();
  const initial=(await make().query('/*stock-history-read:session*/ SELECT @@TRANCOUNT transaction_count,@@OPTIONS session_options;')).recordset?.[0];
  if(!initial||String(initial.transaction_count)!=='0'||(BigInt(initial.session_options)&2n)!==0n)throw failure('ESTOCK_HISTORY_CALLER_TRANSACTION');
  owned=true;await make().query('/*stock-history-read:begin*/ BEGIN TRANSACTION;');READERS.set(parent,make);
  const result=await work(parent);guard();
  await make().query('/*stock-history-read:commit*/ COMMIT TRANSACTION;');owned=false;guard();return result;
 }catch(error){
  if(owned){try{await raw('IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;');owned=false;}catch{
   // An uncertain transaction must never be borrowed by checkout.
   connection.hasError=true;
   if(typeof connection.close==='function')await Promise.race([
    new Promise(resolve=>connection.close(()=>resolve())),new Promise(resolve=>setTimeout(resolve,REQUEST_MS)),
   ]);owned=false;
  }}
  throw error;
 }finally{READERS.delete(parent);release();}
}
module.exports={withStockHistoryReadSession,stockHistoryReadRequest};
