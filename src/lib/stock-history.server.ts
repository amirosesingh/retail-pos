import type {CallerProof} from './privileged-caller.server';
import type {StockHistoryPage,StockHistoryRequest} from './stock-history-report';
import {checkedStockHistoryPage,stockHistoryRequestSchema} from './stock-history-validation';
import {sameBranchId} from './branch-id';

/** A report read only; the service key never accepts a renderer ledger write. */
export async function readStockHistoryPage(proof:CallerProof,input:StockHistoryRequest):Promise<StockHistoryPage>{
 const request=stockHistoryRequestSchema.parse(input);
 const {requireCallerScope}=await import('./privileged-caller.server');
 const {canCrossBranches}=await import('@/core/api/relay-policy.server');
 const scope=await requireCallerScope(proof,{permission:'can_view_inventory'});
 if(scope.kind==='terminal'||!scope.staffUserId)throw new Error('A current staff sign-in is required for historical stock.');
 const owner=scope.role==='admin'||scope.roleSlug==='admin';
 if(!owner&&scope.permissions['page:inventory']===false)throw new Error('Inventory permission is required.');
 if(request.export&&!owner&&(scope.permissions.can_export_reports!==true||scope.permissions['page:reports']===false))throw new Error('Report export permission is required.');
 const branchId=request.branchId??scope.storeId;
 if(!branchId||((scope.storeId||!canCrossBranches(scope))&&(!scope.storeId||!sameBranchId(scope.storeId,branchId))))
  throw new Error('You can only read historical stock for your authorized branch.');
 const {serviceRest}=await import('@/core/api/pos-relay.server');
 const response=await serviceRest('rpc/pos_stock_history_page',{method:'POST',body:JSON.stringify({
  p_actor:scope.staffUserId,p_terminal:scope.terminalId??null,p_branch:branchId,p_cutoff:request.cutoff,p_zone:request.timeZone,
  p_after:request.after??null,p_limit:request.limit??100,p_source_revision:request.sourceRevision??null,p_export:request.export??false,p_closed_shift:request.closedShiftId??null,
 })});
 if(!response.ok){
  const error=await response.json().catch(()=>null) as {code?:string;message?:string}|null;
  if(response.status===404&&error?.code==='PGRST202'&&error.message?.includes('pos_stock_history_page'))return{
   status:'unavailable',reasons:['SCHEMA_NOT_INSTALLED'],cutoff:request.cutoff,timeZone:request.timeZone,branchId,rows:[],next:null,
  };
  if(error?.message?.includes('STOCK_HISTORY_SOURCE_CHANGED'))throw Object.assign(new Error('Stock history changed. Refresh the report before continuing.'),{code:'ESTOCK_HISTORY_SOURCE_CHANGED'});
  if(error?.message?.includes('STOCK_HISTORY_SHIFT_UNAVAILABLE'))throw new Error('The selected shift is not closed or is outside this report branch.');
  if(response.status===401||response.status===403||error?.code==='42501')throw new Error('Your current account or terminal is not allowed to read this stock report.');
  throw new Error(response.status>=500?'The company database did not answer the stock report. Try again shortly.':'The stock-history database structure or report needs review.');
 }
 const page=checkedStockHistoryPage(await response.json(),branchId);
 if(!request.closedShiftId&&page.cutoff!==request.cutoff)throw new Error('The stock report cutoff changed unexpectedly.');
 return page;
}
