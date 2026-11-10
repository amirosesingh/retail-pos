const { stableUuid }=require("./aggregates.cjs");
const { recordId } = require("../../sync/uuid-fields.cjs");
const nativeRefund = require("../../sync/grouped-refund-native.cjs");
class ReceiptRepository{
 constructor(connectionManager,cloud,{financialOperations=null}={}){this.connectionManager=connectionManager;this.cloud=cloud;this.financialOperations=financialOperations;}
 async aggregate(sale){const [items,payments]=await Promise.all([this.connectionManager.pool.request().input("sale",sale.id).query("SELECT * FROM dbo.sale_items WHERE sale_id=@sale ORDER BY created_at,id;"),this.connectionManager.pool.request().input("sale",sale.id).query("SELECT * FROM dbo.payment_transactions WHERE sale_id=@sale ORDER BY created_at,id;")]);return{sale,items:items.recordset??[],payments:payments.recordset??[]};}
 async materialize(remote,branchId){if(!remote?.sale||String(remote.sale.store_id)!==String(branchId))throw Object.assign(new Error("The receipt does not belong to this branch."),{code:"ERECEIPT_BRANCH"});const registry=require("../schema-registry.cjs").loadRegistry();const byName=new Map(registry.tables.map(table=>[table.cloudTable,table]));const sql=this.connectionManager.sql();const tx=new sql.Transaction(this.connectionManager.pool);await tx.begin(sql.ISOLATION_LEVEL?.SERIALIZABLE);try{if(remote.sale.corrected_at){await new sql.Request(tx).input("sale",remote.sale.id).input("version",Number(remote.sale.row_version??0)).input("ids",JSON.stringify((remote.items??[]).map(item=>item.id))).query("IF EXISTS(SELECT 1 FROM dbo.sales WITH(UPDLOCK,HOLDLOCK) WHERE id=@sale AND (row_version>@version OR is_refunded=1)) THROW 51024,'Sync the local refund or newer bill before refreshing its correction.',1; WITH CHANGE_TRACKING_CONTEXT (0x434C4F5544) DELETE FROM dbo.sale_items WHERE sale_id=@sale AND CONVERT(nvarchar(36),id) NOT IN (SELECT value FROM OPENJSON(@ids));");}for(const [name,rows] of [["sales",[remote.sale]],["sale_items",remote.items??[]],["payment_transactions",remote.payments??[]]]){if(rows.length)await this.cloud.applyLocalBatch(tx,byName.get(name),{rows:rows.map(row=>({row_data:row})),tombstones:[]});}await tx.commit();}catch(error){await Promise.resolve(tx.rollback()).catch(()=>undefined);throw error;}}
 async findExact(value,branchId,proof={}){const result=await this.connectionManager.pool.request().input("value",value).input("branch",branchId).query(`SELECT TOP(1)* FROM dbo.sales WHERE store_id=@branch AND (CONVERT(nvarchar(128),id)=@value OR bill_number=@value OR CONVERT(nvarchar(128),client_transaction_id)=@value);`);if(result.recordset?.[0]&&!proof.refresh)return{source:"local",...await this.aggregate(result.recordset[0])};let remote;try{remote=await this.cloud.oldReceipt(value,branchId,proof);}catch(error){const denied=["PERMISSION_DENIED","SESSION_INVALID","STORE_FORBIDDEN"].includes(error?.code);throw Object.assign(new Error(denied?String(error.message):"This receipt is outside local history. Connect to the internet to retrieve and refund it."),{code:denied?error.code:"EONLINE_REQUIRED",cause:error});}if(!remote)return null;await this.materialize(remote,branchId);return{source:"cloud",...remote};}
 async refund({saleId,refundId,branchId,reason=null},financialContext=null,groupedRefund=null){
  if(!/^[0-9a-f-]{36}$/i.test(saleId)||!refundId||refundId.length>128)throw new Error("Stable sale and refund identifiers are required.");
  const operationId=stableUuid({refundId});
  const financial=this.financialOperations?.enabled===true?this.financialOperations:null;
  // Discover scope without retaining a sale lock ahead of the shift/head locks.
  // Existing accepted receipts below do not depend on this current observation.
  let observed=null,observationError=null;
  if(financial){try{observed=(await this.connectionManager.pool.request().input("sale",saleId).input("branch",branchId).query("SELECT TOP(1) id,shift_id FROM dbo.sales WHERE id=@sale AND store_id=@branch;")).recordset?.[0]??null;}catch(error){observationError=error;}}
  const sql=this.connectionManager.sql();const tx=new sql.Transaction(this.connectionManager.pool);await tx.begin(sql.ISOLATION_LEVEL?.SERIALIZABLE);
  try{
   if(groupedRefund?.legacyFence){
    const { isExtendedMixedFence } = require("../../sync/grouped-settings-handoff.cjs");
    if(await isExtendedMixedFence(tx,branchId)) throw nativeRefund.refundHeld();
    groupedRefund.assertCurrent();
    groupedRefund=null;
   }
   const receiptLock=financial||groupedRefund?" WITH(UPDLOCK,HOLDLOCK)":"";
   const prior=(await new sql.Request(tx).input("refund",operationId)
    .query(`SELECT operation_type,entity_id,note FROM dbo.local_operation_receipts${receiptLock} WHERE operation_id=@refund;`)).recordset?.[0];
   if(prior){
    if(prior.operation_type!=="refund"||String(prior.entity_id).toLowerCase()!==saleId.toLowerCase()||
     (prior.note??null)!==reason)
     throw Object.assign(new Error("This refund ID belongs to a different saved operation."),{code:"EIDEMPOTENCY"});
    const owner=await new sql.Request(tx).input("sale",saleId).input("branch",branchId)
     .query("SELECT id FROM dbo.sales WHERE id=@sale AND store_id=@branch;");
    if(!owner.recordset?.length)
     throw Object.assign(new Error("The receipt does not belong to this branch or is unavailable locally."),{code:"ERECEIPT"});
    await tx.commit();return{ok:true,replayed:true,refundId};
   }
   let financialToken=null;
   if(financial){
    if(observationError)throw observationError;
    if(!observed)throw Object.assign(new Error("The receipt does not belong to this branch or is unavailable locally."),{code:"ERECEIPT"});
    if(Object.hasOwn(financialContext??{},'expectedShiftId')&&String(observed.shift_id??'')!==String(financialContext.expectedShiftId??''))throw Object.assign(new Error("The receipt shift changed before its refund could be saved."),{code:"EFINANCIAL_CONTEXT_CHANGED"});
    const shiftId=observed.shift_id==null?null:String(observed.shift_id);
    let parent=null;
    if(shiftId)parent=(await new sql.Request(tx).input("shift",shiftId).input("branch",branchId).query("SELECT id FROM dbo.shifts WITH(UPDLOCK,HOLDLOCK) WHERE id=TRY_CONVERT(uniqueidentifier,@shift) AND store_id=@branch;")).recordset?.[0]??null;
    financialToken=await financial.captureMutation(tx,{branchId,terminalId:financialContext?.terminalId,shiftId,operationId,action:"REFUND",author:financialContext?.author,saleIds:[saleId]});
    if(financialToken&&!parent)throw Object.assign(new Error("The protected refund shift could not be verified."),{code:"EFINANCIAL_CONTEXT_CHANGED"});
   }
   const saleResult=await new sql.Request(tx).input("sale",saleId).input("branch",branchId).query(`SELECT TOP(1) id,is_refunded${financial?",shift_id":""}${groupedRefund?",row_version":""} FROM dbo.sales WITH(UPDLOCK,HOLDLOCK) WHERE id=@sale AND store_id=@branch;`);
   if(!saleResult.recordset?.length)throw Object.assign(new Error("The receipt does not belong to this branch or is unavailable locally."),{code:"ERECEIPT"});
   if(financial&&String(saleResult.recordset[0].shift_id??"")!==String(observed.shift_id??""))throw Object.assign(new Error("The receipt shift changed before its refund could be saved."),{code:"EFINANCIAL_CONTEXT_CHANGED"});
   if(financialToken)financial.assertCurrent(tx,financialToken);
   if(saleResult.recordset[0].is_refunded)throw Object.assign(new Error("This receipt has already been refunded."),{code:"EALREADY"});
   const items=await new sql.Request(tx).input("sale",saleId).query(`SELECT id,product_id,quantity,COALESCE(refunded_qty,0) refunded_qty${groupedRefund?",row_version,branch_id":""} FROM dbo.sale_items WITH(UPDLOCK,HOLDLOCK) WHERE sale_id=@sale ORDER BY id;`);
   const saved = groupedRefund && !financialToken ? await nativeRefund.captureRefund(tx, groupedRefund, {
    branchId, operationId, refundKey: refundId, saleId: recordId(saleId),
    expectedSaleVersion: Number(saleResult.recordset[0].row_version), reason,
   }, items.recordset ?? []) : null;
   const write = (request, statement, declaration = "") => {
    if (!saved) return request.query(statement);
    return request.input("refundContext", sql.VarBinary(128), nativeRefund.refundContext(operationId))
     .query(`${declaration} WITH CHANGE_TRACKING_CONTEXT (@refundContext) ${statement}`);
   };
   const journal=async(table,key,operation="update")=>new sql.Request(tx).input("entity",table).input("entity_id",JSON.stringify(key)).input("operation",operation).input("branch",branchId).input("aggregate",operationId).query("INSERT dbo.sync_change_journal(entity_type,entity_id,operation,branch_id,entity_version,aggregate_id) VALUES(@entity,@entity_id,@operation,@branch,1,@aggregate);");
   for(const item of items.recordset??[]){const qty=Math.max(0,Number(item.quantity)-Number(item.refunded_qty));if(!qty)continue;
    await write(new sql.Request(tx).input("id",item.id).input("qty",qty),
     "UPDATE dbo.sale_items SET refunded_qty=COALESCE(refunded_qty,0)+@qty,row_version=COALESCE(row_version,0)+1 WHERE id=@id;");
    await journal("sale_items",{id:item.id});
    const movement=stableUuid({refundId,itemId:item.id});
    const movementRequest = new sql.Request(tx).input("movement",movement).input("product",item.product_id).input("branch",branchId).input("qty",qty);
    const insertMovement = "INSERT dbo.stock_delta_applied(movement_id,product_id,store_id,delta,applied_at) VALUES(@movement,@product,@branch,@qty,SYSDATETIMEOFFSET());";
    const inserted = saved
     ? (await write(movementRequest, insertMovement)).rowsAffected?.[0] === 1
     : (await movementRequest.query(`IF NOT EXISTS(SELECT 1 FROM dbo.stock_delta_applied WITH(UPDLOCK,HOLDLOCK) WHERE movement_id=@movement)
        BEGIN ${insertMovement} SELECT CAST(1 AS bit) inserted; END ELSE SELECT CAST(0 AS bit) inserted;`)).recordset?.[0]?.inserted;
    if(saved && !inserted)throw nativeRefund.refundHeld();
    if(inserted){
     const stockPath=`$.${JSON.stringify(String(branchId))}`;
     const stockRequest = new sql.Request(tx).input("product",item.product_id).input("qty",qty).input("stock_path",stockPath);
     const stockBucket = "JSON_MODIFY(COALESCE(stock_by_store,N'{}'),@stock_path,COALESCE(TRY_CONVERT(int,JSON_VALUE(COALESCE(stock_by_store,N'{}'),@stock_path)),0)+@qty)";
     let product;
     if(saved){
      // Apply the catalogue transition inside the tagged write so the
      // existing AFTER trigger does not produce an untagged second update.
      const { stockLifecycleDeclaration, stockLifecycleAssignments } = require("../../sync/grouped-live-stock.cjs");
      const total = "COALESCE(product.stock_quantity,0)+@qty";
      product = await write(stockRequest, `UPDATE product SET stock_quantity=${total},stock_by_store=${stockBucket},
        row_version=COALESCE(product.row_version,0)+1,
        updated_at=CASE WHEN @autoArchiveStock=1 AND product.deleted_at IS NULL AND
          (product.is_archived<>CASE WHEN ${total}>0 THEN 0 ELSE 1 END OR (${total}>0 AND product.archived_at IS NOT NULL))
          THEN SYSDATETIMEOFFSET() ELSE product.updated_at END,
        ${stockLifecycleAssignments("product", total)}
        FROM dbo.products AS product WHERE product.id=@product;`,stockLifecycleDeclaration);
     }else{
      product = await stockRequest.query(`UPDATE dbo.products SET stock_quantity=COALESCE(stock_quantity,0)+@qty,
        stock_by_store=${stockBucket},row_version=COALESCE(row_version,0)+1 WHERE id=@product;`);
     }
     if(saved && product.rowsAffected?.[0] !== 1)throw nativeRefund.refundHeld();
     await journal("products",{id:item.product_id});await journal("stock_delta_applied",{movement_id:movement},"insert");
    }
   }
   await write(new sql.Request(tx).input("sale",saleId),
    "UPDATE dbo.sales SET is_refunded=1,row_version=COALESCE(row_version,0)+1 WHERE id=@sale;");
   await journal("sales",{id:saleId});
   if(financialToken){await financial.finalizeMutation(tx,financialToken);financial.assertCurrent(tx,financialToken);}
   await new sql.Request(tx).input("refund",operationId).input("sale",saleId).input("reason",reason).query("INSERT dbo.local_operation_receipts(operation_id,operation_type,entity_id,note) VALUES(@refund,'refund',CONVERT(nvarchar(128),@sale),@reason);");
   if(saved){await nativeRefund.saveRefundEvidence(tx,saved);groupedRefund.assertCurrent();}
   if(financialToken)financial.assertCurrent(tx,financialToken);
   await tx.commit();return{ok:true,replayed:false,refundId};
  }catch(error){await Promise.resolve(tx.rollback()).catch(()=>undefined);throw error;}
 }
}
module.exports={ReceiptRepository};
