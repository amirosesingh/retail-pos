import type {CallerProof} from './privileged-caller.server';
import type {StockHistoryPage,StockHistoryRequest,StockRolloutOpening,StockRolloutReadiness} from './stock-history-report';
import {checkedStockHistoryPage,stockHistoryRequestSchema} from './stock-history-validation';
import {sameBranchId} from './branch-id';
import {RELEASE_CHANNEL} from './release-channel';
import {z} from 'zod';
import {
 checkedStockHistoryMovementPage,stockHistoryMovementRequestSchema,
 type StockHistoryMovementPage,type StockHistoryMovementRequest,
} from './stock-history-movements';

function isMultiDayPeriod(start:string|undefined,cutoff:string,timeZone:string){
 if(!start)return false;
 const date=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'});
 return date.format(new Date(start))!==date.format(new Date(cutoff));
}

export async function authorizeStockHistoryRead(proof:CallerProof,request:Pick<StockHistoryRequest,'branchId'|'closedShiftId'|'export'>){
 const {requireCallerScope}=await import('./privileged-caller.server');
 const {canCrossBranches}=await import('@/core/api/relay-policy.server');
 const scope=await requireCallerScope(proof,{permission:'can_view_inventory'});
 if(scope.kind==='terminal'||!scope.staffUserId)throw new Error('A current staff sign-in is required for historical stock.');
 const owner=scope.role==='admin'||scope.roleSlug==='admin';
 if(!owner&&scope.permissions['page:inventory']===false)throw new Error('Inventory permission is required.');
 if(request.export&&!owner&&(scope.permissions.can_export_reports!==true||scope.permissions['page:reports']===false))throw new Error('Report export permission is required.');
 if(request.closedShiftId&&!owner&&(scope.permissions.can_shift_closing_history_view!==true||scope.permissions['page:shifts']===false))throw new Error('Shift history permission is required for a saved closing cutoff.');
 const branchId=request.branchId??scope.storeId;
 if(!branchId||((scope.storeId||!canCrossBranches(scope))&&(!scope.storeId||!sameBranchId(scope.storeId,branchId))))
  throw new Error('You can only read historical stock for your authorized branch.');
 return {scope,branchId};
}

const rolloutBranch=z.string().min(1).max(128);
const rolloutCutoff=z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{7}Z$/);
const rolloutOpening=z.discriminatedUnion('status',[
 z.object({status:z.literal('already_verified'),branchId:rolloutBranch,cutoff:rolloutCutoff}),
 z.object({status:z.literal('recorded'),branchId:rolloutBranch,cutoff:rolloutCutoff,productCount:z.number().int().min(0).max(10000)}),
 z.object({status:z.literal('waiting'),branchId:rolloutBranch,reasons:z.array(z.string().max(64)).min(1).max(10)}),
]);

async function authorizeStockRollout(proof:CallerProof,branch:string){
 const {scope,branchId}=await authorizeStockHistoryRead(proof,{branchId:branch});
 if(scope.role!=='admin'&&scope.roleSlug!=='admin')throw new Error('Stock history rollout requires an Administrator.');
 return {scope,branchId};
}

export async function readStockRolloutReadiness(proof:CallerProof,branch:string):Promise<StockRolloutReadiness>{
 const {scope,branchId}=await authorizeStockRollout(proof,branch);
 const [{serviceRest},{supabaseConfig}]=await Promise.all([
  import('@/core/api/pos-relay.server'),import('./external-supabase-config'),
 ]);
 const response=await serviceRest('rpc/pos_stock_history_rollout_readiness',{method:'POST',redirect:'error',body:JSON.stringify({
  p_actor:scope.staffUserId,p_terminal:scope.terminalId??null,p_branch:branchId,p_project:new URL(supabaseConfig().url).origin,
 })});
 const payload=await response.json().catch(()=>null);
 if(!response.ok){
  if(response.status===404&&payload?.code==='PGRST202')throw new Error('This database needs the reviewed Stock Report rollout upgrade.');
  throw new Error('The rollout writer evidence could not be checked.');
 }
 const count=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
 const result=z.object({branchId:rolloutBranch,writers:z.number().int().min(0).max(16),
  confirmed:z.number().int().min(0).max(16),reasons:z.array(z.string().max(64)).max(10),
  registrationInventory:z.object({desktop:count,mobile:count,unknown:count,hasUnassignedLocalCandidate:z.boolean()}).optional(),
 }).parse(payload);
 if(!sameBranchId(result.branchId,branchId)||result.confirmed>result.writers)throw new Error('The rollout source returned invalid writer evidence.');
 return result;
}

export async function recordStockRolloutOpening(proof:CallerProof,branch:string):Promise<StockRolloutOpening>{
 if(RELEASE_CHANNEL!=='beta')throw new Error('Stock Report rollout is available on Beta.');
 const {scope,branchId}=await authorizeStockRollout(proof,branch);
 const {serviceRest}=await import('@/core/api/pos-relay.server');
 const response=await serviceRest('rpc/pos_stock_history_initialize_rollout_opening',{method:'POST',body:JSON.stringify({
  p_actor:scope.staffUserId,p_terminal:scope.terminalId??null,p_branch:branchId,
 })});
 const payload=await response.json().catch(()=>null);
 if(!response.ok){
  if(response.status===404&&payload?.code==='PGRST202')throw new Error('This database needs the reviewed Stock Report rollout upgrade.');
  if(payload?.message==='STOCK_OPENING_SOURCE_CHANGED')throw new Error('Inventory changed while the opening was being read. Try again.');
  throw new Error('The rollout opening could not be recorded for this location.');
 }
 const result=rolloutOpening.parse(payload);
 if(!sameBranchId(result.branchId,branchId))throw new Error('The opening source returned a different location.');
 return result;
}

/** A report read only; the service key never accepts a renderer ledger write. */
export async function readStockHistoryPage(proof:CallerProof,input:StockHistoryRequest):Promise<StockHistoryPage>{
 const request=stockHistoryRequestSchema.parse(input);
 const {scope,branchId}=await authorizeStockHistoryRead(proof,request);
 const {serviceRest}=await import('@/core/api/pos-relay.server');
 const readRecorded=async():Promise<StockHistoryPage|null>=>{
  const rpc='pos_stock_history_recorded_page';
  const response=await serviceRest('rpc/'+rpc,{method:'POST',body:JSON.stringify({
   p_actor:scope.staffUserId,p_terminal:scope.terminalId??null,p_branch:branchId,p_cutoff:request.cutoff,p_zone:request.timeZone,
   p_after:request.after??null,p_limit:request.limit??100,p_source_revision:request.sourceRevision??null,p_period_start:request.periodStart??null,
  })});
  const result=await response.json().catch(()=>undefined) as unknown;
  if(!response.ok){
   const error=result as {code?:string;message?:string}|undefined;
   if(response.status===404&&error?.code==='PGRST202'&&error.message?.includes(rpc))return null;
   if(error?.message==='STOCK_HISTORY_PERIOD_INVALID'&&isMultiDayPeriod(request.periodStart,request.cutoff,request.timeZone))return null;
   if(error?.message==='STOCK_HISTORY_SOURCE_CHANGED')throw Object.assign(new Error('Stock history changed. Refresh the report before continuing.'),{code:'ESTOCK_HISTORY_SOURCE_CHANGED'});
   if(response.status===401||response.status===403||error?.code==='42501')throw new Error('Your current account or terminal is not allowed to read this stock report.');
   throw new Error('The recorded stock history could not be verified.');
  }
  if(result===null)return null;
  const page=checkedStockHistoryPage(result,branchId);
  if(page.cutoff!==request.cutoff||page.period?.start!==request.periodStart||(!page.recordedThrough&&
     (page.coverage?.timeGrade!=='recorded'||page.coverage.balanceGrade!=='recorded_provisional')))
   throw new Error('The recorded stock history returned unexpected evidence.');
  return page;
 };
 const allowRecorded=!request.export&&!request.closedShiftId;
 if(allowRecorded&&request.sourceRevision?.startsWith('stock-history-recorded.v1:')){
  const page=await readRecorded();
  if(page)return page;
  throw Object.assign(new Error('Recorded stock history changed. Refresh the report before continuing.'),{code:'ESTOCK_HISTORY_SOURCE_CHANGED'});
 }
 const rpc=request.periodStart?'pos_stock_history_period_page':'pos_stock_history_page';
 const response=await serviceRest('rpc/'+rpc,{method:'POST',body:JSON.stringify({
  p_actor:scope.staffUserId,p_terminal:scope.terminalId??null,p_branch:branchId,p_cutoff:request.cutoff,p_zone:request.timeZone,
  p_after:request.after??null,p_limit:request.limit??100,p_source_revision:request.sourceRevision??null,p_export:request.export??false,p_closed_shift:request.closedShiftId??null,
  ...(request.periodStart?{p_period_start:request.periodStart}:{}),
 })});
 if(!response.ok){
  const error=await response.json().catch(()=>null) as {code?:string;message?:string}|null;
  if(response.status===404&&error?.code==='PGRST202'&&error.message?.includes(rpc))return{
   status:'unavailable',reasons:['SCHEMA_NOT_INSTALLED'],cutoff:request.cutoff,timeZone:request.timeZone,branchId,rows:[],next:null,
  };
  if(error?.message==='STOCK_HISTORY_PERIOD_INVALID'&&isMultiDayPeriod(request.periodStart,request.cutoff,request.timeZone))return{
   status:'unavailable',reasons:['MULTI_DAY_SCHEMA_NOT_INSTALLED'],cutoff:request.cutoff,timeZone:request.timeZone,branchId,rows:[],next:null,
  };
  if(error?.message==='STOCK_HISTORY_RANGE_INVALID')throw new Error('The selected stock movement date range is invalid.');
  if(error?.message?.includes('STOCK_HISTORY_SOURCE_CHANGED'))throw Object.assign(new Error('Stock history changed. Refresh the report before continuing.'),{code:'ESTOCK_HISTORY_SOURCE_CHANGED'});
  if(error?.message?.includes('STOCK_HISTORY_SHIFT_UNAVAILABLE'))throw new Error('The selected shift is not closed or is outside this report branch.');
  if(error?.message?.includes('STOCK_HISTORY_ROW_OVERSIZED'))throw new Error('One historical product record is too large for a safe report page. Ask an administrator to review its saved description.');
  if(response.status===401||response.status===403||error?.code==='42501')throw new Error('Your current account or terminal is not allowed to read this stock report.');
  throw new Error(response.status>=500?'The company database did not answer the stock report. Try again shortly.':'The stock-history database structure or report needs review.');
 }
 const page=checkedStockHistoryPage(await response.json(),branchId);
 if(!request.closedShiftId&&page.cutoff!==request.cutoff)throw new Error('The stock report cutoff changed unexpectedly.');
 if(request.periodStart?(page.period?.start!==request.periodStart):page.period!==undefined)throw new Error('The stock report period changed unexpectedly.');
 if(allowRecorded&&!request.sourceRevision&&!request.after&&page.status==='incomplete'&&
    page.reasons.includes('INCOMPLETE_MOVEMENTS')&&page.reasons.every(reason=>
     ['INCOMPLETE_MOVEMENTS','CLOCK_UNVERIFIED','BASELINE_PREHISTORY_CHANGED'].includes(reason)))
  return await readRecorded()??page;
 return page;
}

export async function readStockHistoryMovements(proof:CallerProof,input:StockHistoryMovementRequest):Promise<StockHistoryMovementPage>{
 const request=stockHistoryMovementRequestSchema.parse(input);
 const {scope,branchId}=await authorizeStockHistoryRead(proof,request);
 const {serviceRest}=await import('@/core/api/pos-relay.server');
 const rpc='pos_stock_history_movements_v1';
 const response=await serviceRest('rpc/'+rpc,{method:'POST',body:JSON.stringify({
  p_actor:scope.staffUserId,p_terminal:scope.terminalId??null,p_branch:branchId,p_product:request.productId,
  p_cutoff:request.cutoff,p_zone:request.timeZone,p_source_revision:request.sourceRevision,
  p_period_start:request.periodStart??null,p_closed_shift:request.closedShiftId??null,
  p_after_effective:request.after?.effectiveAt??null,p_after_id:request.after?.id??null,p_limit:request.limit??50,
 })});
 if(response.ok)return checkedStockHistoryMovementPage(await response.json(),request);
 const error=await response.json().catch(()=>null) as {code?:string;message?:string}|null;
 if(response.status===404&&error?.code==='PGRST202'&&error.message?.includes(rpc))return{
  branchId,productId:request.productId,cutoff:request.cutoff,timeZone:request.timeZone,sourceRevision:request.sourceRevision,
  ...(request.periodStart?{periodStart:request.periodStart}:{}),...(request.closedShiftId?{closedShiftId:request.closedShiftId}:{}),
  status:'unavailable',reasons:['SCHEMA_NOT_INSTALLED'],rows:[],next:null,
 };
 if(error?.message==='STOCK_HISTORY_RANGE_INVALID')throw new Error('The selected stock movement date range is invalid.');
 if(error?.message?.includes('STOCK_HISTORY_SOURCE_CHANGED'))throw Object.assign(new Error('Stock history changed. Refresh the report before continuing.'),{code:'ESTOCK_HISTORY_SOURCE_CHANGED'});
 if(response.status===401||response.status===403||error?.code==='42501')throw new Error('Your current account or terminal is not allowed to read these stock movements.');
 if(error?.message?.includes('STOCK_HISTORY_SHIFT_UNAVAILABLE'))throw new Error('The selected shift is not closed or is outside this report branch.');
 if(error?.message?.includes('STOCK_HISTORY_MOVEMENT_CURSOR_INVALID'))throw new Error('The movement page is no longer available. Open the report again.');
 throw new Error('The historical stock movements could not be verified.');
}
