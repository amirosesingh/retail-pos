'use strict';
const{StockHistoryStore}=require('./db/stock-history.cjs'),{identifier,fail}=require('./db/stock-history-contract.cjs');
// Capability only: never returns stock, identity/key material, arbitrary SQL or
// proof authority. A ready schema alone cannot certify active original capture.
function createStockArrivalCapability({manager,session,terminal,branch,isPosSender,context=()=>[],captureReady=()=>false}){
 return async(event,...args)=>{
  try{
   if(args.length||!isPosSender(event)||!session.hasPosAuthority())fail('PERMISSION_DENIED');
   const pool=manager.pool,epoch=session.epoch(),actor=session.identity(),registered=terminal(),branchId=identifier(branch());
   if(!pool||!actor||actor.source!=='pos'||!registered?.tokenId||registered.deviceUse==='management')fail('PERMISSION_DENIED');
   const author=identifier(actor.authorId,true),binding=()=>JSON.stringify([terminal(),context()]),original=binding();
   const assertCurrent=()=>{if(manager.pool!==pool||session.epoch()!==epoch||!session.hasPosAuthority()||binding()!==original||identifier(branch())!==branchId)fail('ESTOCK_HISTORY_CONTEXT_CHANGED');};
   const allowed=async()=>{
    assertCurrent();const person=(await pool.request().input('arrival_actor',author).query(`SELECT id,user_id,role,role_slug,store_id,is_active,permissions FROM dbo.app_users WHERE id=TRY_CONVERT(uniqueidentifier,@arrival_actor);`)).recordset?.[0];assertCurrent();
    if(!person||person.is_active!==true||identifier(String(person.id),true)!==author||String(person.user_id).toLowerCase()!==String(actor.canonicalSubject??actor.subject).toLowerCase()||
     (person.store_id!=null&&identifier(String(person.store_id))!==branchId))fail('PERMISSION_DENIED');
    const admin=String(person.role??'').toLowerCase()==='admin'||String(person.role_slug??'').toLowerCase()==='admin';let permissions=person.permissions;
    if(!admin){if(typeof permissions==='string')try{permissions=JSON.parse(permissions);}catch{fail('PERMISSION_DENIED');}
     if(!permissions||typeof permissions!=='object'||Array.isArray(permissions)||permissions.can_receive_purchase_order!==true||
      !['purchasing','receiving','suppliers'].some(page=>permissions['page:'+page]!==false))fail('PERMISSION_DENIED');}
   };
   await allowed();const ready=await captureReady({pool,branchId,terminalId:registered.tokenId,authorId:author});assertCurrent();
   if(ready!==true){await allowed();return{ok:true,available:false,reason:'CAPTURE_NOT_ENABLED'};}
   const capability=await new StockHistoryStore(manager,{assertCurrent}).capability(pool);assertCurrent();await allowed();
   if(await captureReady({pool,branchId,terminalId:registered.tokenId,authorId:author})!==true){assertCurrent();return{ok:true,available:false,reason:'CAPTURE_NOT_ENABLED'};}
   assertCurrent();session.touch();
   return{ok:true,available:capability.available===true,...(capability.available?{}:{reason:capability.reason})};
  }catch(error){const denied=error?.code==='PERMISSION_DENIED';return{ok:false,available:false,code:denied?'PERMISSION_DENIED':error?.code==='ESTOCK_HISTORY_CONTEXT_CHANGED'?error.code:'ESTOCK_ARRIVAL_UNAVAILABLE',
   error:denied?'Your current account cannot enter a separate goods-arrival time.':'Goods-arrival capture could not be confirmed. The default save time remains available.'};}
 };
}
function registerStockArrivalCapability(options){const handler=createStockArrivalCapability(options);options.ipcMain.handle('business:stock-arrival-capability',handler);return handler;}
module.exports={createStockArrivalCapability,registerStockArrivalCapability};
